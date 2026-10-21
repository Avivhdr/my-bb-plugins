import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../", import.meta.url));
const worktrees = [];
const processes = [];
const cancellation = new AbortController();
const cancel = () => {
  cancellation.abort();
  for (const run of processes) {
    if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill("SIGTERM");
  }
};
process.on("SIGINT", cancel);
process.on("SIGTERM", cancel);
const evidence = await mkdtemp(join(process.argv[2] ?? tmpdir(), "bbp-196-concurrent-"));
const plugins = [
  {
    name: "codex-quota",
    entry: "scripts/preview-server.mjs",
    deadline: "60000",
    html: "scripts/activity-preview.html",
    tests: "scripts/browser",
    path: "/activity.html",
  },
  {
    name: "compose-chat",
    entry: "tests/preview-server.ts",
    deadline: "30000",
    html: "tests/preview.html",
    tests: "tests/browser",
    path: "/tests/preview.html",
  },
  {
    name: "markdown-reader",
    entry: "tests/preview-server.ts",
    deadline: "30000",
    html: "index.html",
    tests: "tests/browser",
    path: "/",
  },
  {
    name: "tasks-plus",
    entry: "tests/preview-server.ts",
    deadline: "30000",
    html: "tests/preview.html",
    tests: "tests/browser",
    path: "/tests/preview.html",
  },
].filter((plugin) => !process.argv[3] || plugin.name === process.argv[3]);
if (!plugins.length) throw new Error("Unknown browser fixture package");
const dependencies = new Set(plugins.map((plugin) => `bb-plugin-${plugin.name}`));
if (plugins.some((plugin) => plugin.name === "tasks-plus")) {
  dependencies.add("packages/markdown-document");
  dependencies.add("bb-plugin-codex-quota");
}
const git = (args) => execFileSync("git", args, { cwd: repository, encoding: "utf8" });
try {
  cancellation.signal.throwIfAborted();
  const changed = [
    ...git(["diff", "--name-only", "HEAD"]).trim().split("\n"),
    ...git(["ls-files", "--others", "--exclude-standard"]).trim().split("\n"),
  ].filter((path) =>
    /^(scripts\/browser-|scripts\/verify-concurrent-browser-worktrees\.mjs$|bb-plugin-(codex-quota|compose-chat|markdown-reader|tasks-plus)\/)/.test(
      path,
    ),
  );
  for (const side of ["left", "right"]) {
    cancellation.signal.throwIfAborted();
    const tree = join(evidence, `${side}-worktree`);
    git(["worktree", "add", "--detach", tree, "HEAD"]);
    worktrees.push(tree);
    for (const path of changed)
      await cp(join(repository, path), join(tree, path), { recursive: true });
    for (const dependency of dependencies)
      await symlink(
        join(repository, dependency, "node_modules"),
        join(tree, dependency, "node_modules"),
        "dir",
      );
  }
  for (const plugin of plugins) {
    const runs = [];
    for (let index = 0; index < worktrees.length; index++) {
      const side = index === 0 ? "left" : "right";
      const checkout = join(worktrees[index], `bb-plugin-${plugin.name}`);
      const output = join(evidence, plugin.name, side);
      await mkdir(output, { recursive: true });
      const marker = `${plugin.name}-${side}-checkout-marker`;
      const htmlPath = join(checkout, plugin.html);
      await writeFile(
        htmlPath,
        (await readFile(htmlPath, "utf8")).replace(
          "</html>",
          `<div id="bbp-196-checkout-marker">${marker}</div></html>`,
        ),
      );
      const sourceHash = createHash("sha256")
        .update(await readFile(htmlPath))
        .digest("hex");
      assert.ok(
        (await readFile(htmlPath, "utf8")).includes(marker),
        "changed HTML contains its checkout marker",
      );
      const facts = join(output, "browser.json");
      const peer = join(evidence, plugin.name, side === "left" ? "right" : "left", "browser.json");
      const spec = join(checkout, plugin.tests, "bbp-196-concurrent.spec.ts");
      await writeFile(
        spec,
        `
import {test,expect} from '@playwright/test';
import {writeFile,readFile} from 'node:fs/promises';
test('own changed checkout on simultaneous browser runs',async({page,context,baseURL},info)=>{
 const errors:string[]=[];
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/*',route=>new URL(route.request().url()).origin===baseURL?route.continue():route.abort());
 await page.goto(${JSON.stringify(plugin.path)});
 await expect(page.locator('#bbp-196-checkout-marker')).toHaveText(${JSON.stringify(marker)});
 expect(new URL(page.url()).origin).toBe(baseURL);
 const facts={origin:baseURL,marker:${JSON.stringify(marker)},checkout:${JSON.stringify(checkout)},sourceHash:${JSON.stringify(sourceHash)},browser:page.context().browser()?.browserType().name(),started:Date.now()};
 await writeFile(${JSON.stringify(facts)},JSON.stringify(facts,null,2));
 await expect.poll(async()=>{try{return JSON.parse(await readFile(${JSON.stringify(peer)},'utf8')).marker;}catch{return null;}},{timeout:20000}).toBe(${JSON.stringify(`${plugin.name}-${side === "left" ? "right" : "left"}-checkout-marker`)});
 await page.waitForTimeout(1000);
 expect(errors).toEqual([]);
 await page.screenshot({path:${JSON.stringify(join(output, "checkout.png"))}});
 await info.attach('checkout',{body:JSON.stringify(facts),contentType:'application/json'});
});
`,
      );
      const env = { ...process.env };
      for (const key of [
        "CODEX_QUOTA_PREVIEW_PORT",
        "COMPOSE_CHAT_PREVIEW_PORT",
        "MARKDOWN_READER_PREVIEW_PORT",
        "BB_BROWSER_BASE_URL",
        "BB_FIXTURE_RUN_DIR",
        "BB_FIXTURE_PORT",
      ])
        delete env[key];
      cancellation.signal.throwIfAborted();
      const child = spawn(
        process.execPath,
        [
          join(worktrees[index], "scripts/browser-fixture-runner.mjs"),
          plugin.entry,
          plugin.deadline,
          "bbp-196-concurrent.spec.ts",
          "--workers",
          "1",
        ],
        { cwd: checkout, env, stdio: ["ignore", "pipe", "pipe"] },
      );
      const exited = once(child, "exit");
      let log = "";
      child.stdout.on("data", (data) => (log += data.toString()));
      child.stderr.on("data", (data) => (log += data.toString()));
      const run = { child, exited, checkout, output, facts, log: () => log };
      processes.push(run);
      runs.push(run);
    }
    const outcomes = await Promise.allSettled(
      runs.map(async (run) => {
        const [code, signal] = await run.exited;
        await writeFile(join(run.output, "run.log"), run.log());
        for (const path of plugin.name === "tasks-plus"
          ? ["test-results"]
          : ["test-results", "playwright-report"])
          await cp(join(run.checkout, path), join(run.output, path), { recursive: true });
        assert.equal(code, 0, `${plugin.name}: ${signal}\n${run.log()}`);
        const facts = JSON.parse(await readFile(run.facts, "utf8"));
        const ready = run.log().match(/Synthetic preview ready at (http:\/\/127\.0\.0\.1:\d+)/);
        assert.equal(facts.origin, ready?.[1]);
        assert.equal(facts.browser, "chromium");
        await assert.rejects(fetch(facts.origin + plugin.path));
        return facts;
      }),
    );
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    if (rejected) throw rejected.reason;
    const results = outcomes.map((outcome) => outcome.value);
    assert.notEqual(results[0].origin, results[1].origin);
    assert.notEqual(results[0].sourceHash, results[1].sourceHash);
    await writeFile(
      join(evidence, plugin.name, "comparison.json"),
      JSON.stringify(results, null, 2),
    );
    console.log(`PASS ${plugin.name} ${results[0].origin} ${results[1].origin}`);
  }
} finally {
  for (const run of processes) {
    if (run.child.exitCode === null && run.child.signalCode === null) {
      run.child.kill("SIGTERM");
      await run.exited;
    }
  }
  for (const tree of worktrees.reverse()) git(["worktree", "remove", "--force", tree]);
  console.log(`Evidence retained at ${evidence}; removed ${worktrees.length} owned worktrees`);
  process.off("SIGINT", cancel);
  process.off("SIGTERM", cancel);
}
