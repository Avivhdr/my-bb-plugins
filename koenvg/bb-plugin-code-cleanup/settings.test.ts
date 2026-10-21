import { afterEach, describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { defaultGuidance } from "./guidance";

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
            { id: "personal", name: "Personal", kind: "personal" },
          ] as never,
      },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  return host;
}

describe("Settings public operations", () => {
  it("lists only standard projects and reads without creating saved rows", async () => {
    const host = await setup();
    expect(await host.harness.behavior.callRpc("listProjects", {})).toEqual([
      { id: "proj_a", name: "A" },
      { id: "proj_b", name: "B" },
    ]);
    expect(await host.harness.behavior.callRpc("getProject", { projectId: "proj_a" })).toEqual({
      projectId: "proj_a",
      enabled: false,
      enabledOverride: null,
      enableByDefault: false,
      prompt: null,
      effectivePrompt: defaultGuidance("proj_a"),
    });
    expect(host.bb.storage.database().prepare("SELECT * FROM project_settings").all()).toEqual([]);
  });

  it("shares explicit choices with CLI, preserves other rows and prompts, and survives reload", async () => {
    let host = await setup();
    const text = "  Exact custom policy\r\nSecond line\n\n ";
    const db = host.bb.storage.database();
    db.prepare(
      "INSERT INTO project_settings (project_id, enabled, prompt, enabled_override) VALUES (?, ?, ?, ?)",
    ).run("proj_a", 0, text, 0);
    db.prepare(
      "INSERT INTO project_settings (project_id, enabled, prompt, enabled_override) VALUES (?, ?, ?, ?)",
    ).run("proj_b", 1, "B policy", 1);
    const before = db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get("proj_b");
    const rpc = host.harness.behavior.callRpc;
    expect(await rpc("setEnablement", { projectId: "proj_a", enabledOverride: true })).toEqual({
      projectId: "proj_a",
      enabled: true,
      enabledOverride: true,
      enableByDefault: false,
      prompt: text,
      effectivePrompt: text,
    });
    expect((await host.harness.behavior.runCli(["show", "--project", "proj_a"])).stdout).toContain(
      "enabled; prompt: custom",
    );
    expect(
      (
        await host.harness.behavior.resolveAgentConfiguration(
          makePluginAgentConfigurationContext({ project: { id: "proj_a" } }),
        )
      ).instructions,
    ).toBe(text);
    expect(db.prepare("SELECT * FROM project_settings WHERE project_id = ?").get("proj_b")).toEqual(
      before,
    );
    await rpc("setEnablement", { projectId: "proj_a", enabledOverride: false });
    expect(
      (
        await host.harness.behavior.resolveAgentConfiguration(
          makePluginAgentConfigurationContext({ project: { id: "proj_a" } }),
        )
      ).instructions,
    ).toBeNull();
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.pop();
    hosts.push(replacement.harness);
    host = replacement;
    expect(await host.harness.behavior.callRpc("getProject", { projectId: "proj_a" })).toEqual({
      projectId: "proj_a",
      enabled: false,
      enabledOverride: false,
      enableByDefault: false,
      prompt: text,
      effectivePrompt: text,
    });
    await host.harness.behavior.runCli(["enable", "--project", "proj_a"]);
    expect(
      (
        await host.harness.behavior.resolveAgentConfiguration(
          makePluginAgentConfigurationContext({ project: { id: "proj_a" } }),
        )
      ).instructions,
    ).toBe(text);
    for (const context of [
      makePluginAgentConfigurationContext({ project: { id: "proj_a", kind: "personal" } }),
      makePluginAgentConfigurationContext({ project: { id: "" } }),
      makePluginAgentConfigurationContext({
        project: { id: "proj_a" },
        origin: { kind: "fork", pluginId: "side-chat" },
      }),
    ])
      expect(
        (await host.harness.behavior.resolveAgentConfiguration(context)).instructions,
      ).toBeNull();
  });

  it("reports a failed SQLite write without changing saved choices", async () => {
    const host = await setup();
    const db = host.bb.storage.database();
    db.prepare(
      "INSERT INTO project_settings (project_id, enabled, prompt, enabled_override) VALUES (?, ?, ?, ?)",
    ).run("proj_a", 0, "Exact saved text\n", 0);
    db.exec(
      "CREATE TRIGGER reject_fixture_write BEFORE UPDATE ON project_settings BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END",
    );
    await expect(
      host.harness.behavior.callRpc("setEnablement", {
        projectId: "proj_a",
        enabledOverride: true,
      }),
    ).rejects.toThrow("fixture storage failure");
    expect((await host.harness.behavior.runCli(["enable", "--project", "proj_a"])).exitCode).toBe(
      1,
    );
    expect(await host.harness.behavior.callRpc("getProject", { projectId: "proj_a" })).toEqual({
      projectId: "proj_a",
      enabled: false,
      enabledOverride: false,
      enableByDefault: false,
      prompt: "Exact saved text\n",
      effectivePrompt: "Exact saved text\n",
    });
  });
  it("rejects invalid targets and malformed inputs without writes", async () => {
    const host = await setup();
    for (const projectId of ["missing", "personal", ""]) {
      await expect(host.harness.behavior.callRpc("getProject", { projectId })).rejects.toThrow();
      for (const enabledOverride of [true, false, null])
        await expect(
          host.harness.behavior.callRpc("setEnablement", { projectId, enabledOverride }),
        ).rejects.toThrow();
      expect(
        (await host.harness.behavior.runCli(["disable", "--project", projectId])).exitCode,
      ).toBe(1);
    }
    for (const input of [
      { projectId: "proj_a", enabledOverride: "true" },
      { projectId: "proj_a", enabledOverride: true, prompt: "bad" },
      { enabledOverride: true },
      { projectId: "proj_a", enabled: true },
      null,
    ]) {
      await expect(host.harness.behavior.callRpc("setEnablement", input)).rejects.toThrow();
    }
    expect(host.bb.storage.database().prepare("SELECT * FROM project_settings").all()).toEqual([]);
  });
});
