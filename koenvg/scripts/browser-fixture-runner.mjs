import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const originKey = "BB_BROWSER_BASE_URL";
const readyPrefix = "BB_FIXTURE_READY ";
function parseOrigin(input) {
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !Number(url.port || "80") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    input !== url.origin
  ) {
    throw new Error("Expected an actual bare loopback HTTP origin");
  }
  return url.origin;
}
export function browserFixtureOrigin() {
  if (!process.env[originKey])
    throw new Error("Use bun run test:browser to start this checkout's owned fixture");
  return parseOrigin(process.env[originKey]);
}
export function reportPreviewReady(origin) {
  const actual = parseOrigin(origin);
  if (process.env.BB_FIXTURE_RUN_DIR)
    console.log(readyPrefix + JSON.stringify({ version: 1, origin: actual }));
}

function spawnOwned(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const done = new Promise((resolve) => {
    child.once("error", (error) => resolve({ error }));
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  const closed = new Promise((resolve) => child.once("close", resolve));
  const groupExists = () => {
    if (!child.pid) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
      throw error;
    }
  };
  const signalGroup = (signal) => {
    try {
      if (child.pid) process.kill(-child.pid, signal);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  let stopping;
  return {
    child,
    done,
    stop() {
      return (stopping ??= (async () => {
        if (groupExists()) {
          signalGroup("SIGTERM");
          const grace = Date.now() + 5000;
          while (groupExists() && Date.now() < grace) await delay(20);
          if (groupExists()) {
            signalGroup("SIGKILL");
            const deadline = Date.now() + 2000;
            while (groupExists() && Date.now() < deadline) await delay(20);
            if (groupExists())
              throw new Error(
                `Infrastructure failure: owned process group ${child.pid} did not stop`,
              );
          }
        }
        await done;
        await closed;
      })());
    },
  };
}

async function run() {
  const [entry, deadlineText, ...args] = process.argv.slice(2);
  if (!entry || !/^\d+$/.test(deadlineText ?? "") || Number(deadlineText) < 1)
    throw new Error("Expected preview entry and startup deadline");
  if (process.platform === "win32")
    throw new Error("Infrastructure failure: POSIX process groups are required");
  const owners = [];
  let directory;
  let cancellation;
  let failure;
  let fail;
  const failed = new Promise((resolve) => {
    fail = (error) => {
      failure ??= error;
      resolve({ error: failure });
    };
  });
  const cancel = (signal) => {
    cancellation ??= signal;
    fail(new Error(`Cancelled by ${signal}`));
  };
  const interrupt = () => cancel("SIGINT");
  const terminate = () => cancel("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  let deadline;
  let cleanupError;
  let result = 1;
  let shuttingDown = false;
  try {
    directory = await mkdtemp(join(tmpdir(), "bb-browser-fixture-"));
    if (cancellation) throw failure;
    const env = { ...process.env, BB_FIXTURE_PORT: "0", BB_FIXTURE_RUN_DIR: directory };
    delete env[originKey];
    const preview = spawnOwned([resolve(entry)], env);
    owners.push(preview);
    let ready;
    const readiness = new Promise((resolve) => {
      ready = resolve;
    });
    let origin;
    let buffer = "";
    preview.child.stdout.setEncoding("utf8");
    preview.child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (line.length > 65536) {
          fail(new Error("Preview stdout line exceeded limit"));
          continue;
        }
        if (!line.startsWith(readyPrefix)) continue;
        try {
          if (origin) throw new Error("Duplicate preview readiness");
          const record = JSON.parse(line.slice(readyPrefix.length));
          if (record.version !== 1 || Object.keys(record).sort().join(",") !== "origin,version")
            throw new Error("Invalid preview readiness record");
          origin = parseOrigin(record.origin);
          ready({ origin });
        } catch (error) {
          fail(error);
        }
      }
      if (buffer.length > 65536) {
        buffer = "";
        fail(new Error("Preview stdout buffer exceeded limit"));
      }
    });
    preview.child.stdout.on("end", () => {
      if (buffer.startsWith(readyPrefix)) fail(new Error("Incomplete preview readiness record"));
    });
    preview.child.stderr.pipe(process.stderr, { end: false });
    preview.done.then((outcome) => {
      if (!shuttingDown)
        fail(
          outcome.error ??
            new Error(`Preview exited unexpectedly (${outcome.code ?? outcome.signal})`),
        );
    });
    deadline = setTimeout(() => fail(new Error("Preview startup timed out")), Number(deadlineText));
    const startup = await Promise.race([readiness, failed]);
    clearTimeout(deadline);
    if (startup.error || failure) throw startup.error ?? failure;
    const cli = createRequire(join(process.cwd(), "package.json")).resolve("@playwright/test/cli");
    const playwright = spawnOwned(["--bun", cli, "test", ...args], {
      ...env,
      [originKey]: startup.origin,
    });
    owners.push(playwright);
    playwright.child.stdout.pipe(process.stdout, { end: false });
    playwright.child.stderr.pipe(process.stderr, { end: false });
    const outcome = await Promise.race([playwright.done, failed]);
    if (outcome.error) throw outcome.error;
    result = outcome.code ?? 1;
  } catch (error) {
    if (!cancellation) console.error(error);
  } finally {
    clearTimeout(deadline);
    shuttingDown = true;
    try {
      const stopped = await Promise.allSettled(owners.map((owner) => owner.stop()));
      const rejected = stopped.find((outcome) => outcome.status === "rejected");
      if (rejected) {
        cleanupError = rejected.reason;
        console.error(cleanupError);
      } else if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    } catch (error) {
      console.error(error);
      cleanupError = error;
    }
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
  return cleanupError
    ? 1
    : cancellation
      ? cancellation === "SIGINT"
        ? 130
        : 143
      : failure
        ? 1
        : result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await run().catch((error) => {
    console.error(error);
    return 1;
  });
}
