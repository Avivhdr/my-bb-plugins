import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "bun:test";

const repository = fileURLToPath(new URL("../", import.meta.url));
const previews = [
  {
    name: "codex-quota",
    entry: "scripts/preview-server.mjs",
    key: "CODEX_QUOTA_PREVIEW_PORT",
    path: "/calendar.html",
    marker: "calendar.js",
  },
  {
    name: "compose-chat",
    entry: "tests/preview-server.ts",
    key: "COMPOSE_CHAT_PREVIEW_PORT",
    path: "/tests/preview.html",
    marker: "/dist/app.js",
  },
  {
    name: "markdown-reader",
    entry: "tests/preview-server.ts",
    key: "MARKDOWN_READER_PREVIEW_PORT",
    path: "/",
    marker: "/tests/preview.tsx",
  },
  {
    name: "tasks-plus",
    entry: "tests/preview-server.ts",
    key: "BB_FIXTURE_PORT",
    path: "/tests/preview.html",
    marker: "./preview.tsx",
  },
];
function start(preview, parent, port, args = [], preload) {
  const env = { ...process.env, TMPDIR: parent, TMP: parent, TEMP: parent };
  delete env.BB_FIXTURE_RUN_DIR;
  delete env.BB_FIXTURE_PORT;
  delete env[preview.key];
  if (port !== undefined) env[preview.key] = port;
  if (preload) env.DEBUG = "vite:deps";
  const child = spawn(
    process.execPath,
    [...(preload ? ["--preload", preload] : []), preview.entry, ...args],
    {
      cwd: join(repository, `bb-plugin-${preview.name}`),
      env,
      stdio: [preload ? "pipe" : "ignore", "pipe", "pipe"],
    },
  );
  const exited = once(child, "exit");
  let output = "";
  let ready;
  const readiness = new Promise((resolve) => {
    ready = resolve;
  });
  child.stdout.on("data", (data) => {
    output += data.toString();
    const match = output.match(/Synthetic preview ready at (http:\/\/127\.0\.0\.1:\d+)/);
    if (match) ready(match[1]);
  });
  child.stderr.on("data", (data) => (output += data.toString()));
  return {
    child,
    exited,
    output: () => output,
    async ready() {
      return Promise.race([
        readiness,
        exited.then(() => {
          throw new Error(output);
        }),
        delay(15000).then(() => {
          throw new Error(`Readiness timed out: ${output}`);
        }),
      ]);
    },
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        let timedOut = false;
        const watchdog = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, 5000);
        try {
          await exited;
          assert.equal(timedOut, false, output);
        } finally {
          clearTimeout(watchdog);
        }
      }
    },
  };
}
for (const preview of previews) {
  test(`${preview.name} real ephemeral bind, strict refusal and owned cleanup`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-contract-"));
    const owners = [];
    let moduleDirectory;
    await writeFile(join(parent, "historical.png"), "keep");
    const dist = join(repository, `bb-plugin-${preview.name}`, "dist");
    const before = await readdir(dist).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    try {
      if (preview.name === "markdown-reader") {
        moduleDirectory = await mkdtemp(
          join(repository, "bb-plugin-markdown-reader/tests/browser-hmr-contract-"),
        );
        await writeFile(
          join(moduleDirectory, "live.ts"),
          'export const marker = "before"; if (import.meta.hot) import.meta.hot.accept();',
        );
      }
      const first = start(preview, parent);
      owners.push(first);
      const origin = await first.ready();
      const second = start(
        preview,
        parent,
        undefined,
        preview.name === "markdown-reader" ? ["--port=0", "--strictPort"] : [],
      );
      owners.push(second);
      const secondOrigin = await second.ready();
      assert.notEqual(secondOrigin, origin);
      const response = await fetch(origin + preview.path);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes(preview.marker));
      if (preview.name === "compose-chat") {
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal((await fetch(origin + preview.path, { method: "HEAD" })).status, 200);
        assert.equal(await (await fetch(origin + preview.path, { method: "HEAD" })).text(), "");
        assert.equal((await fetch(origin + preview.path, { method: "POST" })).status, 404);
      }
      if (preview.name === "codex-quota") {
        assert.ok(response.headers.get("content-security-policy").includes("connect-src 'none'"));
        assert.equal((await fetch(origin + "/speed-fixture.mjs")).status, 404);
      }
      if (preview.name === "markdown-reader") {
        assert.equal((await fetch(origin + "/tests/preview.tsx")).status, 200);
        const modulePath = `/tests/${moduleDirectory.split("/").at(-1)}/live.ts`;
        const moduleFile = join(moduleDirectory, "live.ts");
        const initialModule = await fetch(origin + modulePath);
        assert.equal(initialModule.status, 200);
        assert.ok((await initialModule.text()).includes('marker = "before"'));
        const ws = new WebSocket(origin.replace("http:", "ws:") + "/", "vite-hmr");
        const message = (type) =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`Missing HMR ${type} on owned listener`)),
              5000,
            );
            ws.onmessage = (event) => {
              const value = JSON.parse(event.data);
              if (value.type === type) {
                clearTimeout(timer);
                resolve(value);
              }
            };
            ws.onerror = (error) => {
              clearTimeout(timer);
              reject(error);
            };
          });
        try {
          await message("connected");
          const update = message("update");
          await writeFile(
            moduleFile,
            'export const marker = "after"; if (import.meta.hot) import.meta.hot.accept();',
          );
          const receipt = await update;
          assert.equal(receipt.type, "update");
          assert.equal(receipt.updates[0].path, modulePath);
          assert.equal(receipt.updates[0].acceptedPath, modulePath);
          const updatedModule = await fetch(
            origin + modulePath + `?t=${receipt.updates[0].timestamp}`,
          );
          assert.equal(updatedModule.status, 200);
          assert.ok((await updatedModule.text()).includes('marker = "after"'));
        } finally {
          ws.close();
        }
      }
      assert.equal(
        (await fetch(origin + "/../package.json")).status,
        ["markdown-reader", "tasks-plus"].includes(preview.name) ? 200 : 404,
      );
      const conflict =
        preview.name === "markdown-reader"
          ? start(preview, parent, "0", ["--port", new URL(origin).port, "--strictPort"])
          : start(preview, parent, new URL(origin).port);
      owners.push(conflict);
      assert.notEqual((await conflict.exited)[0], 0);
      assert.match(conflict.output(), /EADDRINUSE/);
      assert.equal((await fetch(origin + preview.path)).status, 200);
      const invalid = start(preview, parent, "");
      owners.push(invalid);
      assert.notEqual((await invalid.exited)[0], 0);
      assert.match(invalid.output(), /Invalid .*port|Invalid .*PORT/);
      await first.stop();
      await assert.rejects(fetch(origin + preview.path));
      assert.equal((await fetch(secondOrigin + preview.path)).status, 200);
      await Promise.all(owners.map((owner) => owner.stop()));
      assert.deepEqual(await readdir(parent), ["historical.png"]);
      assert.equal(await readFile(join(parent, "historical.png"), "utf8"), "keep");
      assert.deepEqual(
        await readdir(dist).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        }),
        before,
      );
      await assert.rejects(fetch(origin + preview.path));
    } finally {
      await Promise.all(owners.map((owner) => owner.stop()));
      await rm(parent, { recursive: true, force: true });
      if (moduleDirectory) await rm(moduleDirectory, { recursive: true, force: true });
    }
  }, 45000);
  if (preview.name !== "compose-chat") {
    test(`${preview.name} direct cancellation adopts its fresh startup directory`, async () => {
      const parent = await mkdtemp(join(tmpdir(), "preview-startup-contract-"));
      const owner = start(preview, parent);
      try {
        for (let n = 0; n < 1000; n++) {
          if ((await readdir(parent)).length) break;
          if (owner.child.exitCode !== null) throw new Error(owner.output());
          await delay(1);
        }
        owner.child.kill("SIGTERM");
        assert.equal((await owner.exited)[0], 0, owner.output());
        assert.equal(owner.output().includes("Synthetic preview ready"), false);
        assert.deepEqual(await readdir(parent), []);
      } finally {
        await owner.stop();
        await rm(parent, { recursive: true, force: true });
      }
    }, 20000);
  }
}

for (const mode of ["failure", "cancellation"]) {
  test(`tasks-plus runner ${mode} removes only its listener and cache`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "tasks-runner-contract-"));
    const preview = previews.find((preview) => preview.name === "tasks-plus");
    const peer = start(preview, parent);
    let owner;
    try {
      const heldConfig = join(parent, "held-playwright.config.mjs");
      await writeFile(
        heldConfig,
        'console.log("TASKS_PLAYWRIGHT_HELD"); await new Promise(() => setInterval(() => {}, 1000)); export default {};',
      );
      const peerOrigin = await peer.ready();
      const before = await readdir(parent);
      owner = start(
        { ...preview, entry: "../scripts/browser-fixture-runner.mjs" },
        parent,
        undefined,
        [
          preview.entry,
          "30000",
          ...(mode === "failure"
            ? ["--unknown-fixture-option"]
            : ["--list", "--config", heldConfig]),
        ],
      );
      const origin = await owner.ready();
      assert.notEqual(origin, peerOrigin);
      if (mode === "cancellation") {
        const deadline = Date.now() + 10000;
        while (!owner.output().includes("TASKS_PLAYWRIGHT_HELD") && Date.now() < deadline)
          await delay(20);
        assert.ok(owner.output().includes("TASKS_PLAYWRIGHT_HELD"), owner.output());
        owner.child.kill("SIGTERM");
      }
      assert.equal((await owner.exited)[0], mode === "cancellation" ? 143 : 1, owner.output());
      await assert.rejects(fetch(origin + preview.path));
      assert.equal((await fetch(peerOrigin + preview.path)).status, 200);
      assert.deepEqual(await readdir(parent), before);
    } finally {
      await owner?.stop();
      await peer.stop();
      await rm(parent, { recursive: true, force: true });
    }
  }, 30000);
}

for (const [previewName, crawlEnded] of [
  ["markdown-reader", false],
  ["markdown-reader", true],
  ["tasks-plus", false],
  ["tasks-plus", true],
]) {
  test(`${previewName} drains writers (crawl ended ${crawlEnded})`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-optimizer-contract-"));
    const preview = previews.find((preview) => preview.name === previewName);
    const preload = fileURLToPath(
      new URL("./fixtures/markdown-optimizer-preload.mjs", import.meta.url),
    );
    const dist = join(repository, `bb-plugin-${previewName}/dist`);
    const readDist = () =>
      readdir(dist).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    const before = await readDist();
    const owner = start(preview, parent, "0", [], preload);
    const other = start(preview, parent, "0");
    const events = [];
    const waiters = new Map();
    const released = new Set();
    const command = (gate) => {
      if (released.has(gate)) return;
      released.add(gate);
      owner.child.stdin.write(`${gate}\n`);
    };
    const record = (event) => {
      events.push(event);
      waiters.get(event)?.();
      // Draining releases the real writer before removal. The fallback exposes the unfixed leak.
      if (event === "processing-read" || event === "cache-removed") command("writer");
    };
    let stderr = "";
    owner.child.stderr.on("data", (data) => {
      stderr += data.toString();
      let newline;
      while ((newline = stderr.indexOf("\n")) !== -1) {
        const line = stderr.slice(0, newline);
        stderr = stderr.slice(newline + 1);
        if (line.startsWith("OPTIMIZER ")) record(JSON.parse(line.slice(10)).event);
        if (line.includes("static imports crawl ended")) record("crawl-ended");
      }
    });
    const wait = (event) =>
      Promise.race([
        events.includes(event)
          ? Promise.resolve()
          : new Promise((resolve) => waiters.set(event, resolve)),
        owner.exited.then(() => {
          throw new Error(`Exited before ${event}: ${owner.output()}`);
        }),
      ]);
    const watchdog = setTimeout(() => owner.child.kill("SIGKILL"), 15000);
    try {
      await writeFile(join(parent, "historical.png"), "keep");
      const origin = await owner.ready();
      const otherOrigin = await other.ready();
      const otherCache = other.output().match(/Synthetic preview ready at .* \((.+)\)/)[1];
      await wait("scan-held");
      if (crawlEnded) {
        await wait("crawl-held");
        command("crawl");
        await wait("crawl-ended");
      }
      if (previewName === "tasks-plus") {
        const html = await fetch(origin + "/tests/preview.html");
        assert.equal(html.status, 200);
        await html.text();
      }
      owner.child.kill("SIGTERM");
      await wait("shutdown-scan-read");
      command("scan");
      if (!crawlEnded) command("crawl");
      await wait("writer-held");
      const status = await owner.exited;
      console.log(`Optimizer boundary trace (crawl ended ${crawlEnded}): ${events.join(", ")}`);
      assert.deepEqual(status, [0, null], owner.output());
      assert.throws(() => process.kill(owner.child.pid, 0), { code: "ESRCH" });
      await assert.rejects(fetch(origin + "/"));
      assert.equal(await readFile(join(parent, "historical.png"), "utf8"), "keep");
      assert.equal(process.kill(other.child.pid, 0), true);
      const response = await fetch(otherOrigin + "/package.json");
      assert.equal(response.status, 200);
      assert.equal((await response.json()).name, `bb-plugin-${previewName}`);
      assert.deepEqual(
        (await readdir(parent)).sort(),
        ["historical.png", basename(otherCache)].sort(),
      );
      assert.deepEqual(await readDist(), before);
      assert.ok(events.includes("writer-finished"), owner.output());
      assert.ok(
        events.indexOf("writer-finished") < events.indexOf("cache-removing"),
        owner.output(),
      );
      await other.stop();
      assert.deepEqual(await other.exited, [0, null], other.output());
      assert.throws(() => process.kill(other.child.pid, 0), { code: "ESRCH" });
      await assert.rejects(fetch(otherOrigin + "/package.json"));
      assert.deepEqual(await readdir(parent), ["historical.png"]);
    } finally {
      clearTimeout(watchdog);
      if (owner.child.exitCode === null && owner.child.signalCode === null) {
        owner.child.kill("SIGKILL");
      }
      await owner.exited;
      await other.stop();
      await rm(parent, { recursive: true, force: true });
    }
  }, 20000);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  test(`markdown-reader immediate HTML shutdown with pending warmup (${signal})`, async () => {
    const parent = await mkdtemp(join(tmpdir(), "preview-html-shutdown-"));
    const preview = previews.find((preview) => preview.name === "markdown-reader");
    const preload = fileURLToPath(
      new URL("./fixtures/markdown-html-shutdown-preload.mjs", import.meta.url),
    );
    const dist = join(repository, "bb-plugin-markdown-reader/dist");
    const readDist = () =>
      readdir(dist).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    const before = await readDist();
    const owner = start(preview, parent, "0", [], preload);
    const other = start(preview, parent, "0");
    const events = [];
    const waiters = new Map();
    let buffer = "";
    let released = false;
    owner.child.stderr.on("data", (data) => {
      buffer += data.toString();
      let newline;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("HTML_SHUTDOWN ")) continue;
        const event = line.slice(14);
        events.push(event);
        waiters.get(event)?.();
        // The old close path must release the real build too, so a timeout proves a Vite stall.
        if (!released && (event === "shutdown-processing-read" || event === "optimizer-close")) {
          released = true;
          owner.child.stdin.write("writer\n");
        }
      }
    });
    const wait = (event) =>
      Promise.race([
        events.includes(event)
          ? Promise.resolve()
          : new Promise((resolve) => waiters.set(event, resolve)),
        owner.exited.then(() => {
          throw new Error(`Exited before ${event}: ${owner.output()}`);
        }),
      ]);
    const watchdog = setTimeout(() => {
      for (const child of [owner.child, other.child]) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
    }, 15000);
    try {
      await writeFile(join(parent, "historical.png"), "keep");
      const origin = await owner.ready();
      const otherOrigin = await other.ready();
      const otherCache = other.output().match(/Synthetic preview ready at .* \((.+)\)/)[1];
      const response = await fetch(origin + "/");
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes("/tests/preview.tsx"));
      await wait("writer-held");
      await wait("optimized-load-pending");
      owner.child.kill(signal);
      const status = await owner.exited;
      console.log(
        `HTML shutdown trace (${signal}): ${events.join(", ")}; exit ${JSON.stringify(status)}`,
      );
      assert.deepEqual(status, [0, null], owner.output());
      assert.ok(events.includes("writer-released"), owner.output());
      assert.ok(events.includes("writer-settled"), owner.output());
      assert.throws(() => process.kill(owner.child.pid, 0), { code: "ESRCH" });
      await assert.rejects(fetch(origin + "/"));
      assert.equal(await readFile(join(parent, "historical.png"), "utf8"), "keep");
      assert.deepEqual(
        (await readdir(parent)).sort(),
        ["historical.png", basename(otherCache)].sort(),
      );
      assert.equal(process.kill(other.child.pid, 0), true);
      const otherResponse = await fetch(otherOrigin + "/");
      assert.equal(otherResponse.status, 200);
      assert.ok((await otherResponse.text()).includes("/tests/preview.tsx"));
      other.child.kill(signal);
      assert.deepEqual(await other.exited, [0, null], other.output());
      assert.throws(() => process.kill(other.child.pid, 0), { code: "ESRCH" });
      await assert.rejects(fetch(otherOrigin + "/"));
      assert.deepEqual(await readdir(parent), ["historical.png"]);
      assert.deepEqual(await readDist(), before);
    } finally {
      clearTimeout(watchdog);
      for (const child of [owner.child, other.child]) {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      }
      await Promise.all([owner.exited, other.exited]);
      await rm(parent, { recursive: true, force: true });
    }
  }, 20000);
}

test("tasks-plus drains a pending transform before closing its watcher", async () => {
  const parent = await mkdtemp(join(tmpdir(), "tasks-transform-contract-"));
  const moduleDirectory = await mkdtemp(join(repository, "packages/tasks-watch-contract-"));
  await writeFile(
    join(moduleDirectory, "tsconfig.json"),
    '{"compilerOptions":{"target":"ES2022"}}',
  );
  await writeFile(
    join(moduleDirectory, "entry.ts"),
    'export const marker: string = "owned transform";',
  );
  const loader = join(repository, "bb-plugin-tasks-plus/tests", basename(moduleDirectory) + ".ts");
  await writeFile(
    loader,
    "export { marker } from " + JSON.stringify(join(moduleDirectory, "entry.ts")) + ";",
  );
  const preview = previews.find((preview) => preview.name === "tasks-plus");
  const preload = fileURLToPath(new URL("./fixtures/tasks-transform-preload.mjs", import.meta.url));
  const owner = start(preview, parent, "0", [], preload);
  const watchdog = setTimeout(() => owner.child.kill("SIGKILL"), 15000);
  let request;
  const wait = async (event) => {
    const marker = JSON.stringify({ event });
    const deadline = Date.now() + 10000;
    while (!owner.output().includes(marker) && Date.now() < deadline) await delay(10);
    assert.ok(owner.output().includes(marker), owner.output());
  };
  try {
    const origin = await owner.ready();
    await wait("optimizer-ready");
    request = fetch(origin + "/tests/" + basename(loader)).catch(() => null);
    await wait("tsconfig-held");
    owner.child.kill("SIGTERM");
    await wait("environment-close-started");
    owner.child.stdin.end("release\n");
    assert.deepEqual(await owner.exited, [0, null], owner.output());
    const events = owner
      .output()
      .split("\n")
      .filter((line) => line.startsWith("TRANSFORM "))
      .map((line) => JSON.parse(line.slice("TRANSFORM ".length)).event);
    console.log("Transform shutdown trace: " + events.join(", "));
    assert.equal(events.includes("late-watch-add"), false, owner.output());
    const environmentFinished = events.indexOf("environment-close-finished");
    assert.ok(
      environmentFinished >= 0 && environmentFinished < events.indexOf("watcher-close-started"),
      owner.output(),
    );
    assert.deepEqual(await readdir(parent), []);
    await assert.rejects(fetch(origin + preview.path));
  } finally {
    clearTimeout(watchdog);
    if (owner.child.exitCode === null && owner.child.signalCode === null)
      owner.child.stdin.end("release\n");
    await owner.stop();
    await request;
    await rm(parent, { recursive: true, force: true });
    await rm(loader, { force: true });
    await rm(moduleDirectory, { recursive: true, force: true });
  }
}, 25000);
