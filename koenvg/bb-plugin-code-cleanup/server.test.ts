import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});

async function setup() {
  const host = createFakePluginHost({
    pluginId: "code-cleanup",
    sdk: {
      projects: {
        list: async () =>
          [
            { id: "proj_a", name: "A", kind: "standard" },
            { id: "proj_b", name: "B", kind: "standard" },
            { id: "proj_personal", name: "Personal", kind: "personal" },
          ] as never,
      },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  return host;
}

describe("project management CLI", () => {
  it("opts in only one standard project, preserves its override across disable and reload", async () => {
    const host = await setup();
    const cli = host.harness.behavior.runCli;
    expect((await cli(["show", "--project", "proj_a"])).stdout).toContain("disabled");
    expect((await cli(["enable", "--project", "proj_a"])).exitCode).toBe(0);
    expect(
      (await cli(["prompt", "set", "--project", "proj_a", "--text", "Custom policy"])).exitCode,
    ).toBe(0);
    expect((await cli(["show", "--project", "proj_a"])).stdout).toMatch(
      /enabled.*custom|custom.*enabled/s,
    );
    expect((await cli(["show", "--project", "proj_b"])).stdout).toContain("disabled");
    expect((await cli(["disable", "--project", "proj_a"])).exitCode).toBe(0);
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.pop();
    hosts.push(replacement.harness);
    expect(
      (await replacement.harness.behavior.runCli(["show", "--project", "proj_a"])).stdout,
    ).toMatch(/disabled.*custom|custom.*disabled/s);
    expect(
      (await replacement.harness.behavior.runCli(["enable", "--project", "proj_a"])).exitCode,
    ).toBe(0);
    expect(
      (await replacement.harness.behavior.runCli(["prompt", "reset", "--project", "proj_a"]))
        .exitCode,
    ).toBe(0);
    expect(
      (await replacement.harness.behavior.runCli(["show", "--project", "proj_a"])).stdout,
    ).toMatch(/enabled.*default|default.*enabled/s);
  });

  it("rejects unknown and personal projects and does not modify saved state", async () => {
    const host = await setup();
    const cli = host.harness.behavior.runCli;
    for (const id of ["missing", "proj_personal"]) {
      expect((await cli(["enable", "--project", id])).exitCode).toBe(1);
      expect((await cli(["prompt", "set", "--project", id, "--text", "bad"])).exitCode).toBe(1);
    }
    expect((await cli(["show", "--project", "proj_a"])).stdout).toContain("disabled");
  });

  it("rejects blank, oversized, or malformed input without replacing a valid override", async () => {
    const host = await setup();
    const cli = host.harness.behavior.runCli;
    expect((await cli(["prompt", "set", "--project", "proj_a", "--text", "Good"])).exitCode).toBe(
      0,
    );
    for (const text of ["  \n  ", "x".repeat(4097)]) {
      expect((await cli(["prompt", "set", "--project", "proj_a", "--text", text])).exitCode).toBe(
        1,
      );
    }
    expect((await cli(["prompt", "set", "--project", "proj_a"])).exitCode).toBe(1);
    expect((await cli(["enable", "--project", "proj_a", "--garbage"])).exitCode).toBe(1);
    expect((await cli(["show", "--project", "proj_a"])).stdout).toMatch(/custom/);
    // The original exact value remains in the host database.
    const row = host.bb.storage
      .database()
      .prepare("SELECT prompt FROM project_settings WHERE project_id = ?")
      .get("proj_a");
    expect(row).toEqual({ prompt: "Good" });
  });

  it("renders help for all supported subcommands", async () => {
    const host = await setup();
    const root = await host.harness.behavior.runCli(["--help"]);
    expect(root.exitCode).toBe(0);
    expect(root.stdout).toContain("prompt set");
    expect(root.stdout).toContain("enablement reset");
    for (const args of [
      ["prompt", "set", "--help"],
      ["show", "--help"],
      ["enablement", "reset", "--help"],
    ]) {
      const result = await host.harness.behavior.runCli(args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("--project");
    }
  });
});
