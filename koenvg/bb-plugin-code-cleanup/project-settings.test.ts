import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { openProjectSettings } from "./project-settings";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});

describe("project settings", () => {
  it("defaults to off and isolates saved overrides by project", () => {
    const host = createFakePluginHost({ pluginId: "code-cleanup" });
    hosts.push(host.harness);
    const settings = openProjectSettings(host.bb);
    expect(settings.get("proj_a")).toEqual({ enabled: false, enabledOverride: null, prompt: null });
    settings.setEnabled("proj_a", true);
    settings.setPrompt("proj_a", "Find worthwhile cleanup");
    expect(settings.get("proj_a")).toEqual({
      enabled: true,
      enabledOverride: true,
      prompt: "Find worthwhile cleanup",
    });
    expect(settings.get("proj_b")).toEqual({ enabled: false, enabledOverride: null, prompt: null });
    settings.setEnabled("proj_a", false);
    expect(settings.get("proj_a")).toEqual({
      enabled: false,
      enabledOverride: false,
      prompt: "Find worthwhile cleanup",
    });
    settings.setEnabled("proj_a", true);
    settings.resetPrompt("proj_a");
    expect(settings.get("proj_a")).toEqual({ enabled: true, enabledOverride: true, prompt: null });
  });

  it("persists rows across an atomic plugin reload and closes the old handle", async () => {
    const host = createFakePluginHost({ pluginId: "code-cleanup" });
    hosts.push(host.harness);
    const settings = openProjectSettings(host.bb);
    settings.setPrompt("proj_a", "Project A policy");
    settings.setEnabled("proj_a", true);
    const replacement = await host.harness.lifecycle.reload(plugin);
    hosts.pop();
    hosts.push(replacement.harness);
    const reloaded = openProjectSettings(replacement.bb);
    expect(reloaded.get("proj_a")).toEqual({
      enabled: true,
      enabledOverride: true,
      prompt: "Project A policy",
    });
    expect(() => settings.get("proj_a")).toThrow();
  });
});
