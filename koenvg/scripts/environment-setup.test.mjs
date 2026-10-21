import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const bash = execFileSync("bash", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
const requiredVersion = readFileSync(join(repository, ".bun-version"), "utf8").trim();

function runSetup(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "bb-environment-setup-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin);
  for (const name of [".bb-env-setup.sh", ".bun-version", "package.json", "bun.lock"]) {
    copyFileSync(join(repository, name), join(root, name));
  }
  const bunLog = join(root, "bun-arguments");
  const bunCwd = join(root, "bun-cwd");
  const installEnv = join(root, "install-env");
  if (!options.missingBun) {
    writeFileSync(
      join(bin, "bun"),
      `#!${bash}
printf '%s\\n' "$*" >> "$SETUP_TEST_BUN_LOG"
case "$1" in
  --version) echo "$SETUP_TEST_BUN_VERSION"; exit "$SETUP_TEST_VERSION_EXIT" ;;
  install)
    pwd > "$SETUP_TEST_BUN_CWD"
    printf '%s' "\${NODE_ENV-unset}" > "$SETUP_TEST_INSTALL_ENV"
    exit "$SETUP_TEST_INSTALL_EXIT" ;;
  *) exit 99 ;;
esac
`,
      { mode: 0o755 },
    );
  }
  const result = spawnSync(bash, [join(root, ".bb-env-setup.sh")], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: bin,
      NODE_ENV: "production",
      SETUP_TEST_BUN_VERSION: options.bunVersion ?? requiredVersion,
      SETUP_TEST_BUN_LOG: bunLog,
      SETUP_TEST_BUN_CWD: bunCwd,
      SETUP_TEST_INSTALL_ENV: installEnv,
      SETUP_TEST_VERSION_EXIT: String(options.versionExit ?? 0),
      SETUP_TEST_INSTALL_EXIT: String(options.installExit ?? 0),
    },
  });
  if (result.error) throw result.error;
  function readOptional(path) {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return "";
      throw error;
    }
  }
  return {
    ...result,
    root,
    bunLog: readOptional(bunLog),
    bunCwd: readOptional(bunCwd),
    installEnv: readOptional(installEnv),
  };
}

test("pinned Bun installs only locked root tools, including dev tools in production mode", (t) => {
  const result = runSetup(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.bunLog, "--version\ninstall --frozen-lockfile\n");
  assert.equal(result.bunCwd.trim(), result.root);
  assert.equal(result.installEnv, "unset");
  for (const name of [".bun-version", "package.json", "bun.lock"]) {
    assert.equal(
      readFileSync(join(result.root, name), "utf8"),
      readFileSync(join(repository, name), "utf8"),
    );
  }
  const manifest = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  assert.equal(manifest.packageManager, `bun@${requiredVersion}`);
  assert.equal(manifest.engines.bun, requiredVersion);
});

for (const bunVersion of ["1.3.14", "1.4.2", "1.4.4", "1.4.3-canary.1"]) {
  test(`unpinned Bun ${bunVersion} fails before installation`, (t) => {
    const result = runSetup(t, { bunVersion });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`Setup requires Bun ${requiredVersion}`));
    assert.ok(result.stderr.includes(bunVersion));
    assert.equal(result.bunLog, "--version\n");
  });
}

test("missing Bun fails with a useful error", (t) => {
  const result = runSetup(t, { missingBun: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Setup requires Bun/);
  assert.equal(result.bunLog, "");
});

test("a broken Bun executable fails before installation", (t) => {
  const result = runSetup(t, { versionExit: 2 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Bun could not run/);
  assert.equal(result.bunLog, "--version\n");
});

test("an install failure is returned without retry or fallback", (t) => {
  const result = runSetup(t, { installExit: 42 });
  assert.equal(result.status, 42);
  assert.equal(result.bunLog.split("\n").filter((line) => line.startsWith("install ")).length, 1);
});
