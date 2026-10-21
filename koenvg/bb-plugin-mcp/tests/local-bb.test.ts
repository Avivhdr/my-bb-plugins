import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";

const runner = fileURLToPath(new URL("../scripts/local-bb.mjs", import.meta.url));
const fixtures: string[] = [];

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "mcp-local-bb-test-"));
  fixtures.push(root);
  const pkg = join(root, "plugin");
  const bb = join(pkg, "node_modules/bb-app");
  const sdk = join(pkg, "node_modules/@get-bb/plugin-sdk");
  const script = join(pkg, "scripts/local-bb.mjs");
  const calls = join(root, "calls.jsonl");
  const sentinel = join(root, "global-sentinel");
  const data = join(root, "inherited-data");
  for (const dir of [join(pkg, "scripts"), join(bb, "dist"), sdk, data]) {
    mkdirSync(dir, { recursive: true });
  }
  if (existsSync(runner)) copyFileSync(runner, script);
  const manifest = {
    name: "fixture-plugin",
    devDependencies: { "bb-app": "1.2.3", "@get-bb/plugin-sdk": "2.3.4" },
  };
  const bbManifest = { name: "bb-app", version: "1.2.3", bin: { bb: "dist/bb.js" } };
  const sdkManifest = { name: "@get-bb/plugin-sdk", version: "2.3.4" };
  function json(path: string, value: unknown) {
    writeFileSync(path, JSON.stringify(value));
  }
  json(join(pkg, "package.json"), manifest);
  json(join(bb, "package.json"), bbManifest);
  json(join(sdk, "package.json"), sdkManifest);
  writeFileSync(join(data, "keep"), "live-data-must-survive");
  writeFileSync(
    join(bb, "dist/bb.js"),
    `const fs = require("node:fs");
const path = require("node:path");
const env = process.env;
if (env.BB_CLI) { fs.writeFileSync(env.SENTINEL, "hijacked"); process.exit(91); }
const action = process.argv[3];
fs.writeFileSync(path.join(env.BB_DATA_DIR, "owned"), "temporary");
fs.appendFileSync(env.CALLS, JSON.stringify({
  argv: process.argv.slice(2), cwd: process.cwd(), data: env.BB_DATA_DIR,
  routing: [env.BB_CLI ?? null, env.BB_CLI_DIR ?? null, env.BB_CLI_REEXEC ?? null],
  inheritedVersion: env.BB_APP_VERSION ?? null,
  bbVersion: require("../package.json").version,
}) + "\\n");
if (env.FAIL_ACTION === action) process.exit(Number(env.FAIL_CODE));
if (env.SIGNAL_ACTION === action) process.kill(process.pid, "SIGTERM");
if (action === "build") {
  fs.mkdirSync(path.join(process.cwd(), "dist"), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), "dist/server.meta.json"), JSON.stringify({
    bbVersion: require("../package.json").version,
    sdkVersion: require("../../@get-bb/plugin-sdk/package.json").version,
  }));
}
`,
  );
  writeFileSync(join(root, "bb"), `#!/bin/sh\nprintf hijacked > '${sentinel}'\nexit 92\n`, {
    mode: 0o755,
  });
  function run(args: string[] = ["check"], extra: NodeJS.ProcessEnv = {}, entry = script) {
    const result = spawnSync(process.execPath, [entry, ...args], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: root,
        BB_CLI: join(root, "bb"),
        BB_CLI_DIR: root,
        BB_CLI_REEXEC: "1",
        BB_APP_VERSION: "99.99.99",
        BB_DATA_DIR: data,
        CALLS: calls,
        SENTINEL: sentinel,
        ...extra,
      },
    });
    const records = existsSync(calls)
      ? readFileSync(calls, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, records };
  }
  return {
    root,
    pkg,
    bb,
    sdk,
    script,
    sentinel,
    data,
    manifest,
    bbManifest,
    sdkManifest,
    json,
    run,
  };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

it.each(["check", "build"])(
  "runs local %s from an arbitrary cwd despite hostile routing",
  (action) => {
    const f = fixture();
    const result = f.run([action]);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.records.map((record) => record.argv)).toEqual([
      ["plugin", "types", f.pkg, "--check"],
      ...(action === "build" ? [["plugin", "build", f.pkg]] : []),
    ]);
    for (const record of result.records) {
      expect(record.cwd).toBe(f.pkg);
      expect(record.routing).toEqual([null, null, null]);
      expect(record.inheritedVersion).toBe(null);
      expect(record.bbVersion).toBe("1.2.3");
      expect(record.data).not.toBe(f.data);
      if (record.argv[1] === "build") {
        expect(record.data).toBe(join(f.pkg, "node_modules/.cache/mcp-local-bb"));
        expect(readFileSync(join(record.data, "owned"), "utf8")).toBe("temporary");
      } else {
        expect(existsSync(record.data)).toBe(false);
      }
    }
    expect(existsSync(f.sentinel)).toBe(false);
    expect(readFileSync(join(f.data, "keep"), "utf8")).toBe("live-data-must-survive");
    if (action === "build") {
      expect(JSON.parse(readFileSync(join(f.pkg, "dist/server.meta.json"), "utf8"))).toEqual({
        bbVersion: "1.2.3",
        sdkVersion: "2.3.4",
      });
    }
  },
);

it("retains the owned build cache across builds but removes each check's temporary data", () => {
  const f = fixture();
  expect(f.run(["build"]).status).toBe(0);
  const result = f.run(["build"]);
  expect(result.status).toBe(0);
  expect(result.records.map((record) => record.argv[1])).toEqual([
    "types",
    "build",
    "types",
    "build",
  ]);
  const cache = join(f.pkg, "node_modules/.cache/mcp-local-bb");
  expect(result.records[1].data).toBe(cache);
  expect(result.records[3].data).toBe(cache);
  expect(readFileSync(join(cache, "owned"), "utf8")).toBe("temporary");
  expect(existsSync(result.records[0].data)).toBe(false);
  expect(existsSync(result.records[2].data)).toBe(false);
  expect(result.records[0].data).not.toBe(result.records[2].data);
});

it("uses the declared npm string bin target", () => {
  const f = fixture();
  f.json(join(f.bb, "package.json"), { ...f.bbManifest, bin: "dist/bb.js" });
  const result = f.run();
  expect(result.status).toBe(0);
  expect(result.records.map((record) => record.argv)).toEqual([
    ["plugin", "types", f.pkg, "--check"],
  ]);
});

it("supports package and installed dependency symlinks", () => {
  const f = fixture();
  const linked = join(f.root, "linked-plugin");
  const external = join(f.root, "external-bb-app");
  mkdirSync(external);
  copyFileSync(join(f.bb, "package.json"), join(external, "package.json"));
  mkdirSync(join(external, "dist"));
  copyFileSync(join(f.bb, "dist/bb.js"), join(external, "dist/bb.js"));
  rmSync(f.bb, { recursive: true });
  symlinkSync(external, f.bb, "dir");
  symlinkSync(f.pkg, linked, "dir");
  const result = f.run(["check"], {}, join(linked, "scripts/local-bb.mjs"));
  expect(result.status).toBe(0);
  expect(result.records.map((record) => record.argv)).toEqual([
    ["plugin", "types", f.pkg, "--check"],
  ]);
});

it.each([[], ["unknown"], ["check", "extra"], ["build", "--help"]])(
  "rejects invalid arguments %j before invoking BB",
  (...args: string[]) => {
    const f = fixture();
    const result = f.run(args);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage:");
    expect(result.records).toEqual([]);
  },
);

it.each([
  "stale bb",
  "stale sdk",
  "missing bb",
  "missing sdk",
  "malformed bb",
  "malformed sdk",
  "wrong package name",
  "non-exact pin",
  "missing pin",
  "missing bin",
  "malformed bin",
  "absent bin target",
  "escaping bin target",
])("rejects %s without invoking BB", (failure) => {
  const f = fixture();
  if (failure === "stale bb") f.bbManifest.version = "1.2.2";
  if (failure === "stale sdk") f.sdkManifest.version = "2.3.3";
  if (failure === "wrong package name") f.sdkManifest.name = "other";
  if (failure === "non-exact pin") f.manifest.devDependencies["bb-app"] = "^1.2.3";
  if (failure === "missing pin") {
    delete (f.manifest.devDependencies as Record<string, string>)["bb-app"];
  }
  if (failure === "missing bin") delete (f.bbManifest as { bin?: unknown }).bin;
  if (failure === "malformed bin") (f.bbManifest as { bin: unknown }).bin = { bb: 42 };
  if (failure === "absent bin target") f.bbManifest.bin.bb = "dist/absent.js";
  if (failure === "escaping bin target") {
    writeFileSync(join(f.root, "outside.js"), "process.exit(0)");
    symlinkSync(join(f.root, "outside.js"), join(f.bb, "dist/escape.js"));
    f.bbManifest.bin.bb = "dist/escape.js";
  }
  f.json(join(f.pkg, "package.json"), f.manifest);
  f.json(join(f.bb, "package.json"), f.bbManifest);
  f.json(join(f.sdk, "package.json"), f.sdkManifest);
  if (failure === "missing bb") rmSync(join(f.bb, "package.json"));
  if (failure === "missing sdk") rmSync(join(f.sdk, "package.json"));
  if (failure === "malformed bb") writeFileSync(join(f.bb, "package.json"), "{");
  if (failure === "malformed sdk") writeFileSync(join(f.sdk, "package.json"), "null");
  const result = f.run(["build"]);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("local-bb:");
  expect(result.records).toEqual([]);
});

it.each([
  ["types", 23, ["types"]],
  ["build", 27, ["types", "build"]],
] as const)("preserves %s failure and cleans temporary data", (action, code, actions) => {
  const f = fixture();
  const result = f.run(["build"], { FAIL_ACTION: action, FAIL_CODE: String(code) });
  expect(result.status).toBe(code);
  expect(result.records.map((record) => record.argv[1])).toEqual(actions);
  expect(existsSync(result.records[0].data)).toBe(false);
  if (action === "build") {
    expect(result.records[1].data).toBe(join(f.pkg, "node_modules/.cache/mcp-local-bb"));
    expect(readFileSync(join(result.records[1].data, "owned"), "utf8")).toBe("temporary");
  }
});

it("fails nonzero on child signal and cleans temporary data", () => {
  const f = fixture();
  const result = f.run(["build"], { SIGNAL_ACTION: "types" });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("SIGTERM");
  expect(result.records.map((record) => record.argv[1])).toEqual(["types"]);
  expect(existsSync(result.records[0].data)).toBe(false);
});

it("fails nonzero on spawn error and cleans temporary data", () => {
  const f = fixture();
  const preload = join(f.root, "spawn-error.cjs");
  const attempted = join(f.root, "attempted-data");
  writeFileSync(
    preload,
    `const cp = require("node:child_process");
cp.spawnSync = (_file, _args, options) => {
  require("node:fs").writeFileSync(${JSON.stringify(attempted)}, options.env.BB_DATA_DIR);
  return { error: new Error("spawn EACCES"), status: null, signal: null };
};
require("node:module").syncBuiltinESMExports();
`,
  );
  const result = f.run(["build"], { NODE_OPTIONS: `--require=${preload}` });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("spawn EACCES");
  expect(result.records).toEqual([]);
  expect(existsSync(readFileSync(attempted, "utf8"))).toBe(false);
});
