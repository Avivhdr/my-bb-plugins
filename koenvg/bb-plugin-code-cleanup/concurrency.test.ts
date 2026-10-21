import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFakePluginHost,
  makePluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import type { ProjectState } from "./rpc";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});
async function setup() {
  const host = createFakePluginHost({
    pluginId: "code-cleanup",
    sdk: {
      projects: {
        list: async () =>
          [
            { id: "proj_a", name: "Alpha", kind: "standard" },
            { id: "proj_b", name: "Beta", kind: "standard" },
          ] as never,
      },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  return host;
}

describe("concurrent public configuration writes", () => {
  it("compares two UI saves atomically and rejects stale Save and Reset after a CLI write", async () => {
    const host = await setup();
    const rpc = host.harness.behavior.callRpc;
    const cli = host.harness.behavior.runCli;
    const loaded = (await rpc("getProject", { projectId: "proj_a" })) as ProjectState;
    const results = await Promise.all(
      ["First\n", "Second\n"].map((prompt) =>
        rpc("setPrompt", { projectId: "proj_a", prompt, expectedPrompt: loaded.prompt }),
      ),
    );
    expect(results.map((r) => (r as { status: string }).status).sort()).toEqual([
      "conflict",
      "saved",
    ]);
    await cli(["enable", "--project", "proj_a"]);
    const before = (await rpc("getProject", { projectId: "proj_a" })) as ProjectState;
    const exact = "  # CLI\r\n\n`$(name)` and ${HOME}\n ";
    await cli(["prompt", "set", "--project", "proj_a", "--text", exact]);
    const signals = host.harness.inspection.realtimeSignals.length;
    for (const prompt of ["Stale save", null]) {
      expect(
        await rpc("setPrompt", { projectId: "proj_a", prompt, expectedPrompt: before.prompt }),
      ).toEqual({
        status: "conflict",
        state: { ...before, prompt: exact, effectivePrompt: exact },
      });
    }
    expect(host.harness.inspection.realtimeSignals).toHaveLength(signals);
    expect(await rpc("getProject", { projectId: "proj_b" })).toMatchObject({
      prompt: null,
      enabledOverride: null,
    });
    expect(
      await rpc("setPrompt", { projectId: "proj_a", prompt: null, expectedPrompt: exact }),
    ).toMatchObject({ status: "saved", state: { prompt: null, enabledOverride: true } });
  });

  it("requires an exact nullable precondition, preserves inheritance, and emits only confirmed changes", async () => {
    const host = await setup();
    const rpc = host.harness.behavior.callRpc;
    for (const expectedPrompt of [undefined, false, 1]) {
      await expect(
        rpc("setPrompt", { projectId: "proj_a", prompt: "Draft", expectedPrompt }),
      ).rejects.toThrow();
    }
    await host.harness.behavior.setSettings({ enableByDefault: true });
    await rpc("setPrompt", { projectId: "proj_a", prompt: "Exact\n ", expectedPrompt: null });
    await rpc("setEnablement", { projectId: "proj_b", enabledOverride: false });
    expect(host.harness.inspection.realtimeSignals.map((s) => s.payload)).toEqual([
      { kind: "default" },
      { kind: "project", projectId: "proj_a" },
      { kind: "project", projectId: "proj_b" },
    ]);
    expect(await rpc("getProject", { projectId: "proj_a" })).toMatchObject({
      enabled: true,
      enabledOverride: null,
    });
    expect(
      await rpc("setPrompt", { projectId: "proj_a", prompt: "Wrong", expectedPrompt: "Exact\n" }),
    ).toMatchObject({ status: "conflict" });
    const context = makePluginAgentConfigurationContext({ project: { id: "proj_a" } });
    expect((await host.harness.behavior.resolveAgentConfiguration(context)).instructions).toBe(
      "Exact\n ",
    );
  });

  it("notification failure does not turn persisted UI, CLI, or default writes into failures", async () => {
    const host = await setup();
    vi.spyOn(host.bb.realtime, "publish").mockImplementation(() => {
      throw new Error("delivery failed");
    });
    const rpc = host.harness.behavior.callRpc;
    expect(
      await rpc("setPrompt", { projectId: "proj_a", prompt: "Saved", expectedPrompt: null }),
    ).toMatchObject({ status: "saved", state: { prompt: "Saved" } });
    expect((await host.harness.behavior.runCli(["enable", "--project", "proj_a"])).exitCode).toBe(
      0,
    );
    await host.harness.behavior.setSettings({ enableByDefault: true });
    expect(await rpc("getProject", { projectId: "proj_a" })).toMatchObject({
      enabled: true,
      prompt: "Saved",
      enableByDefault: true,
    });
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.pop();
    hosts.push(replacement.harness);
    expect(
      await replacement.harness.behavior.callRpc("getProject", { projectId: "proj_a" }),
    ).toMatchObject({ enabled: true, prompt: "Saved", enableByDefault: true });
  });
});
