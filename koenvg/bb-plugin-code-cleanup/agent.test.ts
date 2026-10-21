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
          ] as never,
      },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  const context = (id: string, kind: "standard" | "personal" = "standard") =>
    makePluginAgentConfigurationContext({ project: { id, kind } });
  return { host, context };
}

describe("conditional guidance", () => {
  it("contributes once only to an opted-in standard project", async () => {
    const { host, context } = await setup();
    const resolve = host.harness.behavior.resolveAgentConfiguration;
    expect(await resolve(context("proj_a"))).toEqual({ tools: [], skills: [], instructions: null });
    await host.harness.behavior.runCli(["enable", "--project", "proj_a"]);
    expect(await resolve(context("proj_a"))).toEqual({
      tools: [],
      skills: [],
      instructions: defaultGuidance("proj_a"),
    });
    expect(await resolve(context("proj_b"))).toEqual({ tools: [], skills: [], instructions: null });
    expect(await resolve(context("proj_a", "personal"))).toEqual({
      tools: [],
      skills: [],
      instructions: null,
    });
    const sideChat = makePluginAgentConfigurationContext({
      project: { id: "proj_a" },
      origin: { kind: "fork", pluginId: "side-chat" },
    });
    expect(await resolve(sideChat)).toEqual({ tools: [], skills: [], instructions: null });
    await host.harness.behavior.runCli(["disable", "--project", "proj_a"]);
    expect(await resolve(context("proj_a"))).toEqual({ tools: [], skills: [], instructions: null });
  });

  it("uses the replacement instruction and emits exactly one section after reload", async () => {
    const { host, context } = await setup();
    await host.harness.behavior.runCli(["enable", "--project", "proj_a"]);
    await host.harness.behavior.runCli([
      "prompt",
      "set",
      "--project",
      "proj_a",
      "--text",
      "Custom cleanup policy",
    ]);
    expect(
      (await host.harness.behavior.resolveAgentConfiguration(context("proj_a"))).instructions,
    ).toBe("Custom cleanup policy");
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.pop();
    hosts.push(replacement.harness);
    const resolved = await replacement.harness.behavior.resolveAgentConfiguration(
      context("proj_a"),
    );
    expect(resolved).toEqual({ tools: [], skills: [], instructions: "Custom cleanup policy" });
    await replacement.harness.behavior.runCli(["prompt", "reset", "--project", "proj_a"]);
    const defaultText =
      (await replacement.harness.behavior.resolveAgentConfiguration(context("proj_a")))
        .instructions ?? "";
    expect(defaultText).toBe(defaultGuidance("proj_a"));
    expect(defaultText.match(/Code Cleanup for BB project/g)).toHaveLength(1);
  });
});
