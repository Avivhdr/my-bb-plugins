import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {"check" | "build"} Action */
/** @typedef {{ bbVersion: string, sdkVersion: string, bbBin: string }} LocalToolchain */

function readManifest(root) {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Invalid package manifest at ${root}`);
  }
  return manifest;
}

/** @returns {LocalToolchain} */
function localToolchain(root) {
  const manifest = readManifest(root);
  const installed = new Map();
  for (const name of ["bb-app", "@get-bb/plugin-sdk"]) {
    const pin = manifest.devDependencies?.[name];
    if (typeof pin !== "string" || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(pin)) {
      throw new Error(`${name} requires an exact stable development pin`);
    }
    const packageRoot = realpathSync(join(root, "node_modules", name));
    const dependency = readManifest(packageRoot);
    if (dependency.name !== name || dependency.version !== pin) {
      throw new Error(`Installed ${name} must match ${pin}. Run bun install --frozen-lockfile.`);
    }
    installed.set(name, { root: packageRoot, manifest: dependency });
  }
  const bb = installed.get("bb-app");
  const bin = typeof bb.manifest.bin === "string" ? bb.manifest.bin : bb.manifest.bin?.bb;
  if (typeof bin !== "string" || !bin.trim() || isAbsolute(bin)) {
    throw new Error("Installed bb-app must declare a relative bb bin target");
  }
  const bbBin = realpathSync(join(bb.root, bin));
  const target = relative(bb.root, bbBin);
  if (
    target === ".." ||
    target.startsWith(`..${sep}`) ||
    isAbsolute(target) ||
    !statSync(bbBin).isFile()
  ) {
    throw new Error("Installed bb-app bin must be a file inside its package");
  }
  return {
    bbVersion: bb.manifest.version,
    sdkVersion: installed.get("@get-bb/plugin-sdk").manifest.version,
    bbBin,
  };
}

function main(args) {
  if (args.length !== 1 || !["check", "build"].includes(args[0])) {
    throw new Error("Usage: node scripts/local-bb.mjs <check|build>");
  }
  const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
  const toolchain = localToolchain(root);
  const env = { ...process.env };
  for (const name of ["BB_CLI", "BB_CLI_DIR", "BB_CLI_REEXEC", "BB_APP_VERSION"]) {
    delete env[name];
  }
  const data = mkdtempSync(join(tmpdir(), "mcp-local-bb-"));
  env.BB_DATA_DIR = data;
  try {
    const commands = [["plugin", "types", root, "--check"]];
    if (args[0] === "build") commands.push(["plugin", "build", root]);
    for (const command of commands) {
      if (command[1] === "build") {
        env.BB_DATA_DIR = join(root, "node_modules/.cache/mcp-local-bb");
        mkdirSync(env.BB_DATA_DIR, { recursive: true });
      }
      const result = spawnSync(process.execPath, [toolchain.bbBin, ...command], {
        cwd: root,
        env,
        stdio: "inherit",
        shell: false,
      });
      if (result.error) throw result.error;
      if (result.signal) throw new Error(`Local BB terminated by ${result.signal}`);
      if (result.status !== 0) return result.status ?? 1;
    }
    return 0;
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`local-bb: ${error.message}`);
  process.exitCode = 1;
}
