import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "bun:test";

import { browserFixtureOrigin } from "./browser-fixture-runner.mjs";

test("config accepts only the runner's actual bare origin", () => {
  const original = process.env.BB_BROWSER_BASE_URL;
  try {
    delete process.env.BB_BROWSER_BASE_URL;
    assert.throws(() => browserFixtureOrigin(), /Use bun run test:browser/);
    for (const input of [
      "http://localhost:1234",
      "http://127.0.0.1:1234/",
      "http://127.0.0.1:1234/path",
      "http://user@127.0.0.1:1234",
      "https://127.0.0.1:1234",
      "http://127.0.0.1:1234?x",
      "http://127.0.0.1:1234#x",
      "http://127.0.0.1:0",
      "http://127.0.0.1:01234",
      "http://127.0.0.1:80",
    ]) {
      process.env.BB_BROWSER_BASE_URL = input;
      assert.throws(() => browserFixtureOrigin(), /Expected an actual bare loopback HTTP origin/);
    }
    process.env.BB_BROWSER_BASE_URL = "http://127.0.0.1:43210";
    assert.equal(browserFixtureOrigin(), "http://127.0.0.1:43210");
    process.env.BB_BROWSER_BASE_URL = "http://127.0.0.1";
    assert.equal(browserFixtureOrigin(), "http://127.0.0.1");
  } finally {
    if (original === undefined) delete process.env.BB_BROWSER_BASE_URL;
    else process.env.BB_BROWSER_BASE_URL = original;
  }
});
const runner = fileURLToPath(new URL("./browser-fixture-runner.mjs", import.meta.url));
async function scenario(mode, args = [], viaPackage = false) {
  const root = await mkdtemp(join(tmpdir(), "browser-runner-contract-"));
  await mkdir(join(root, "node_modules/@playwright/test"), { recursive: true });
  await mkdir(join(root, "temporary"));
  await writeFile(join(root, "temporary/historical.png"), "keep");
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      type: "module",
      scripts: { "test:browser": `${process.execPath} ${runner} preview.mjs 3000` },
    }),
  );
  await writeFile(
    join(root, "node_modules/@playwright/test/package.json"),
    '{"exports":{"./cli":"./cli.js"}}',
  );
  await writeFile(
    join(root, "node_modules/@playwright/test/cli.js"),
    `
import {writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
await writeFile('handoff.json', JSON.stringify({args:process.argv.slice(2),origin:process.env.BB_BROWSER_BASE_URL,parent:process.env.BB_FIXTURE_RUN_DIR}));
const response=await fetch(process.env.BB_BROWSER_BASE_URL);
await writeFile('body.txt',await response.text());
if(process.env.MODE==='descendant') {
 const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
 await writeFile('descendant.txt',String(child.pid));
 await new Promise(resolve=>setTimeout(resolve,200));
}
if(['cancel-tests','preview-death','duplicate-late'].includes(process.env.MODE))setInterval(()=>{},1000);
else process.exit(process.env.MODE==='test-failure'?7:0);
`,
  );
  await writeFile(
    join(root, "preview.mjs"),
    `
import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import {reportPreviewReady} from ${JSON.stringify(new URL("./browser-fixture-runner.mjs", import.meta.url).href)};
await writeFile('parent.txt',process.env.BB_FIXTURE_RUN_DIR);
const mode=process.env.MODE;
if(mode==='startup-failure')throw new Error('controlled startup failure');
if(['cancel-startup','timeout'].includes(mode)){console.log('STARTING');await new Promise(()=>{});}
const server=createServer((req,res)=>res.end('owned checkout marker'));
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
const origin='http://127.0.0.1:'+server.address().port;
if(mode==='malformed')console.log('BB_FIXTURE_READY {"version":1,"origin":"http://localhost:1234"}');
else if(mode==='split') {const record='BB_FIXTURE_READY '+JSON.stringify({version:1,origin})+'\\n';process.stdout.write(record.slice(0,15));setTimeout(()=>process.stdout.write(record.slice(15)),20);}
else reportPreviewReady(origin);
if(mode==='duplicate-late')setTimeout(()=>reportPreviewReady(origin),300);
if(mode==='preview-death')setTimeout(()=>process.exit(9),300);
process.on('SIGTERM',()=>{server.closeAllConnections();server.close()});
process.on('SIGINT',()=>{server.closeAllConnections();server.close()});
`,
  );
  const child = spawn(
    process.execPath,
    viaPackage
      ? ["run", "test:browser", ...args]
      : [runner, "preview.mjs", mode === "timeout" ? "100" : "3000", ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        MODE: mode,
        TMPDIR: join(root, "temporary"),
        TMP: join(root, "temporary"),
        TEMP: join(root, "temporary"),
        BB_BROWSER_BASE_URL: "http://127.0.0.1:1",
        BB_FIXTURE_RUN_DIR: "/not-owned",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const exited = once(child, "exit");
  let output = "";
  child.stdout.on("data", (data) => (output += data.toString()));
  child.stderr.on("data", (data) => (output += data.toString()));
  return {
    root,
    child,
    exited,
    output: () => output,
    async waitFor(file) {
      for (let n = 0; n < 300; n++) {
        try {
          return await readFile(join(root, file), "utf8");
        } catch {}
        if (child.exitCode !== null) throw new Error(output);
        await delay(10);
      }
      throw new Error(`Timed out waiting for ${file}: ${output}`);
    },
    async clean() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await exited;
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

for (const mode of [
  "success",
  "split",
  "test-failure",
  "startup-failure",
  "timeout",
  "malformed",
  "duplicate-late",
  "preview-death",
  "descendant",
]) {
  test(`runner owns URL and cleanup on ${mode}`, async () => {
    const args = [
      "suite.spec.ts",
      "--grep",
      "quoted two words",
      "--grep",
      "second quoted value",
      "another.spec.ts",
      "--grep-invert",
      "skip",
      "--reporter",
      "list",
      "--output",
      "retained evidence",
      "--list",
    ];
    const run = await scenario(mode, args);
    try {
      const [code] = await run.exited;
      assert.equal(
        code,
        mode === "test-failure" ? 7 : ["success", "split", "descendant"].includes(mode) ? 0 : 1,
        run.output(),
      );
      const diagnostics = {
        "startup-failure": "controlled startup failure",
        timeout: "Preview startup timed out",
        malformed: "Expected an actual bare loopback HTTP origin",
        "duplicate-late": "Duplicate preview readiness",
        "preview-death": "Preview exited unexpectedly (9)",
      };
      if (diagnostics[mode]) assert.ok(run.output().includes(diagnostics[mode]), run.output());
      assert.deepEqual(await readdir(join(run.root, "temporary")), ["historical.png"]);
      assert.equal(await readFile(join(run.root, "temporary/historical.png"), "utf8"), "keep");
      if (["success", "split", "test-failure", "descendant"].includes(mode)) {
        const handoff = JSON.parse(await readFile(join(run.root, "handoff.json"), "utf8"));
        assert.deepEqual(handoff.args, ["test", ...args]);
        assert.match(handoff.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
        assert.equal(await readFile(join(run.root, "body.txt"), "utf8"), "owned checkout marker");
        await assert.rejects(fetch(handoff.origin));
      }
      if (mode === "descendant") {
        const pid = Number(await readFile(join(run.root, "descendant.txt"), "utf8"));
        assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
      }
    } finally {
      await run.clean();
    }
  }, 15000);
}
for (const [mode, signal, code] of [
  ["cancel-startup", "SIGTERM", 143],
  ["cancel-tests", "SIGINT", 130],
]) {
  test(`runner cleans ${mode}`, async () => {
    const run = await scenario(mode);
    try {
      await run.waitFor(mode === "cancel-startup" ? "parent.txt" : "handoff.json");
      run.child.kill(signal);
      run.child.kill(signal);
      assert.equal((await run.exited)[0], code, run.output());
      assert.equal(run.output().includes("Infrastructure failure"), false, run.output());
      assert.deepEqual(await readdir(join(run.root, "temporary")), ["historical.png"]);
    } finally {
      await run.clean();
    }
  }, 15000);
}

test("package command forwards delimiter, positional filters and quoted values", async () => {
  const args = [
    "--",
    "suite.spec.ts",
    "--grep",
    "two words",
    "--output",
    "retained evidence",
    "--reporter",
    "list",
    "--list",
  ];
  const run = await scenario("success", args, true);
  try {
    assert.equal((await run.exited)[0], 0, run.output());
    const handoff = JSON.parse(await readFile(join(run.root, "handoff.json"), "utf8"));
    assert.deepEqual(handoff.args, ["test", ...args.slice(1)]);
    assert.equal(await readFile(join(run.root, "body.txt"), "utf8"), "owned checkout marker");
    assert.deepEqual(await readdir(join(run.root, "temporary")), ["historical.png"]);
  } finally {
    await run.clean();
  }
});
