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
const projects = ["enabled", "disabled", "prompt_only", "absent", "new_prompt"].map((id) => ({
  id,
  name: id,
  kind: "standard",
}));
function fixture() {
  const host = createFakePluginHost({
    pluginId: "code-cleanup",
    sdk: { projects: { list: async () => projects as never } },
  });
  hosts.push(host.harness);
  return host;
}
const exact = "  Legacy prompt\r\n\n`$(literal)` ${text}\n ";

describe("enablement inheritance through the official host", () => {
  it("declares an initially disabled host field and signals only confirmed effective changes", async () => {
    const host = fixture();
    await plugin(host.bb);
    expect(host.harness.inspection.registrations.settingsDescriptors).toEqual({
      enableByDefault: {
        type: "boolean",
        default: false,
        label: "Enable for projects without an override",
        description:
          "Includes new standard projects. Explicit project choices stay unchanged. This does not turn the BB plugin on or off.",
      },
    });
    await host.harness.behavior.setSettings({ enableByDefault: false });
    expect(host.harness.inspection.realtimeSignals).toEqual([]);
    await host.harness.behavior.setSettings({ enableByDefault: true });
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "settings.changed", payload: { kind: "default" } },
    ]);
    await expect(host.harness.behavior.setSettings({ enableByDefault: "true" })).rejects.toThrow();
    expect(
      await host.harness.behavior.callRpc("getProject", { projectId: "absent" }),
    ).toMatchObject({ enabled: true, enabledOverride: null, enableByDefault: true });
    expect(host.harness.inspection.realtimeSignals).toHaveLength(1);
    await host.harness.behavior.setSettings({ enableByDefault: null });
    expect(
      await host.harness.behavior.callRpc("getProject", { projectId: "absent" }),
    ).toMatchObject({ enabled: false, enabledOverride: null, enableByDefault: false });
  });

  it("does not report a persisted default as failed when notification delivery fails", async () => {
    const host = fixture();
    // A public API adapter models a transport outage; storage, Settings, RPC and resolution stay real.
    await plugin({
      ...host.bb,
      realtime: {
        publish() {
          throw new Error("Fixture transport failure");
        },
      },
    });
    await expect(
      host.harness.behavior.setSettings({ enableByDefault: true }),
    ).resolves.toBeUndefined();
    expect(
      await host.harness.behavior.callRpc("getProject", { projectId: "absent" }),
    ).toMatchObject({ enabled: true, enabledOverride: null, enableByDefault: true });
    expect(host.harness.inspection.logEntries).toContainEqual(
      expect.objectContaining({
        level: "warn",
        message:
          "Configuration saved, but Settings notification failed. Refresh Settings to read the saved value.",
      }),
    );
  });

  it("migrates every legacy choice once and preserves exact prompt bytes across reloads", async () => {
    let host = fixture();
    const db = host.bb.storage.database();
    host.bb.storage.migrate(db, [
      `CREATE TABLE IF NOT EXISTS project_settings (
      project_id TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      prompt TEXT
    )`,
    ]);
    db.prepare("INSERT INTO project_settings (project_id, enabled, prompt) VALUES (?, ?, ?)").run(
      "enabled",
      1,
      exact,
    );
    db.prepare("INSERT INTO project_settings (project_id, enabled, prompt) VALUES (?, ?, ?)").run(
      "disabled",
      0,
      null,
    );
    db.prepare("INSERT INTO project_settings (project_id, prompt) VALUES (?, ?)").run(
      "prompt_only",
      exact,
    );
    await plugin(host.bb);
    expect(
      await host.harness.behavior.callRpc("getProject", { projectId: "absent" }),
    ).toMatchObject({ enabled: false, enabledOverride: null, enableByDefault: false });
    for (const [projectId, enabled] of [
      ["enabled", true],
      ["disabled", false],
      ["prompt_only", false],
    ] as const) {
      expect(await host.harness.behavior.callRpc("getProject", { projectId })).toMatchObject({
        enabled,
        enabledOverride: enabled,
        enableByDefault: false,
      });
    }
    await host.harness.behavior.setSettings({ enableByDefault: true });
    for (const [projectId, enabled, prompt] of [
      ["enabled", true, exact],
      ["disabled", false, null],
      ["prompt_only", false, exact],
    ] as const) {
      expect(await host.harness.behavior.callRpc("getProject", { projectId })).toMatchObject({
        enabled,
        enabledOverride: enabled,
        prompt,
      });
    }
    expect(
      (await host.harness.behavior.runCli(["enablement", "reset", "--project", "prompt_only"]))
        .exitCode,
    ).toBe(0);
    for (let i = 0; i < 2; i++) {
      host = await host.harness.lifecycle.reload(plugin);
      hosts.pop();
      hosts.push(host.harness);
      expect(
        await host.harness.behavior.callRpc("getProject", { projectId: "prompt_only" }),
      ).toMatchObject({ enabled: true, enabledOverride: null, prompt: exact });
      expect(
        await host.harness.behavior.callRpc("getProject", { projectId: "enabled" }),
      ).toMatchObject({ enabled: true, enabledOverride: true, prompt: exact });
      expect(
        await host.harness.behavior.callRpc("getProject", { projectId: "disabled" }),
      ).toMatchObject({ enabled: false, enabledOverride: false, prompt: null });
    }
  });

  it("starts off, keeps prompt writes independent, and shares CLI and RPC resolution", async () => {
    const host = fixture();
    await plugin(host.bb);
    const rpc = host.harness.behavior.callRpc;
    const cli = host.harness.behavior.runCli;
    expect(await rpc("getProject", { projectId: "absent" })).toMatchObject({
      enabled: false,
      enabledOverride: null,
      enableByDefault: false,
    });
    for (const enableByDefault of [false, true]) {
      await host.harness.behavior.setSettings({ enableByDefault });
      await rpc("setPrompt", { projectId: "new_prompt", prompt: exact, expectedPrompt: null });
      expect(await rpc("getProject", { projectId: "new_prompt" })).toMatchObject({
        enabled: enableByDefault,
        enabledOverride: null,
        prompt: exact,
      });
      await cli(["prompt", "reset", "--project", "new_prompt"]);
      expect(await rpc("getProject", { projectId: "new_prompt" })).toMatchObject({
        enabled: enableByDefault,
        enabledOverride: null,
        prompt: null,
      });
    }
    await rpc("setPrompt", { projectId: "absent", prompt: exact, expectedPrompt: null });
    await rpc("setEnablement", { projectId: "absent", enabledOverride: false });
    expect((await cli(["show", "--project", "absent"])).stdout).toContain(
      "disabled; prompt: custom; enablement: project override",
    );
    await rpc("setEnablement", { projectId: "absent", enabledOverride: null });
    expect(await rpc("getProject", { projectId: "absent" })).toMatchObject({
      enabled: true,
      enabledOverride: null,
      prompt: exact,
    });
    expect((await cli(["show", "--project", "absent"])).stdout).toContain(
      "enabled; prompt: custom; enablement: default",
    );
  });

  it("updates fresh sessions without reload, preserves explicit choices and excludes other contexts", async () => {
    let host = fixture();
    await plugin(host.bb);
    const context = (id: string) => makePluginAgentConfigurationContext({ project: { id } });
    const initial = await host.harness.behavior.resolveAgentConfiguration(context("absent"));
    await host.harness.behavior.runCli(["enable", "--project", "enabled"]);
    await host.harness.behavior.runCli(["disable", "--project", "disabled"]);
    await host.harness.behavior.runCli([
      "prompt",
      "set",
      "--project",
      "new_prompt",
      "--text",
      exact,
    ]);
    for (const enableByDefault of [true, false, true]) {
      await host.harness.behavior.setSettings({ enableByDefault });
      const resolve = host.harness.behavior.resolveAgentConfiguration;
      expect((await resolve(context("absent"))).instructions).toBe(
        enableByDefault ? defaultGuidance("absent") : null,
      );
      expect((await resolve(context("new_prompt"))).instructions).toBe(
        enableByDefault ? exact : null,
      );
      expect((await resolve(context("enabled"))).instructions).toBe(defaultGuidance("enabled"));
      expect((await resolve(context("disabled"))).instructions).toBeNull();
      for (const excluded of [
        context(""),
        makePluginAgentConfigurationContext({ project: { id: "absent", kind: "personal" } }),
        makePluginAgentConfigurationContext({
          project: { id: "absent" },
          origin: { kind: "fork", pluginId: "side-chat" },
        }),
      ]) {
        expect((await resolve(excluded)).instructions).toBeNull();
      }
    }
    expect(initial.instructions).toBeNull();
    // Atomic reload is the official stop/start seam. Stored host settings survive it.
    host = await host.harness.lifecycle.reload(plugin);
    hosts.pop();
    hosts.push(host.harness);
    expect(
      (await host.harness.behavior.resolveAgentConfiguration(context("new_prompt"))).instructions,
    ).toBe(exact);
    expect(
      await host.harness.behavior.callRpc("getProject", { projectId: "disabled" }),
    ).toMatchObject({ enabled: false, enabledOverride: false, enableByDefault: true });
  });
});
