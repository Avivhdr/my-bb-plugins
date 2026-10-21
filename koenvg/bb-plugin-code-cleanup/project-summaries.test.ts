import { afterEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { projectConfiguration } from "./configuration";
import { openProjectSettings } from "./project-settings";
import { settingsContract } from "./rpc";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});
const projects = [
  { id: "proj_z", name: "Zulu", kind: "standard" },
  { id: "proj_b", name: "Alpha", kind: "standard" },
  { id: "proj_a", name: "Alpha", kind: "standard" },
  { id: "proj_c", name: "Custom disabled", kind: "standard" },
  { id: "proj_d", name: "Default custom", kind: "standard" },
  { id: "personal", name: "Personal", kind: "personal" },
];
async function setup() {
  const host = createFakePluginHost({
    pluginId: "code-cleanup",
    sdk: {
      projects: { list: async () => projects as never },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  return host;
}

describe("read-only project summaries", () => {
  it.each([false, true])(
    "resolves all saved sources with default %s through the registered endpoint",
    async (enableByDefault) => {
      const host = await setup();
      const rpc = host.harness.behavior.callRpc;
      await host.harness.behavior.setSettings({ enableByDefault });
      await rpc("setEnablement", { projectId: "proj_a", enabledOverride: true });
      await rpc("setEnablement", { projectId: "proj_b", enabledOverride: false });
      await rpc("setEnablement", { projectId: "proj_c", enabledOverride: false });
      await rpc("setPrompt", {
        projectId: "proj_c",
        prompt: "  Exact\ncustom ",
        expectedPrompt: null,
      });
      await rpc("setPrompt", {
        projectId: "proj_d",
        prompt: "Inherited custom",
        expectedPrompt: null,
      });
      const db = host.bb.storage.database();
      const before = db.prepare("SELECT * FROM project_settings ORDER BY project_id").all();
      const notifications = host.harness.inspection.realtimeSignals.length;
      const expected = [
        {
          id: "proj_a",
          name: "Alpha",
          enabled: true,
          enabledOverride: true,
          promptSource: "default",
        },
        {
          id: "proj_b",
          name: "Alpha",
          enabled: false,
          enabledOverride: false,
          promptSource: "default",
        },
        {
          id: "proj_c",
          name: "Custom disabled",
          enabled: false,
          enabledOverride: false,
          promptSource: "custom",
        },
        {
          id: "proj_d",
          name: "Default custom",
          enabled: enableByDefault,
          enabledOverride: null,
          promptSource: "custom",
        },
        {
          id: "proj_z",
          name: "Zulu",
          enabled: enableByDefault,
          enabledOverride: null,
          promptSource: "default",
        },
      ];
      expect(await rpc("listProjectSummaries", {})).toEqual(expected);
      expect(await rpc("listProjectSummaries", {})).toEqual(expected);
      expect(db.prepare("SELECT * FROM project_settings ORDER BY project_id").all()).toEqual(
        before,
      );
      expect(host.harness.inspection.realtimeSignals).toHaveLength(notifications);
      expect(await rpc("listProjects", {})).toEqual(
        projects.filter((p) => p.kind === "standard").map(({ id, name }) => ({ id, name })),
      );
    },
  );
  it("captures the default once and does not insert unconfigured projects", async () => {
    const host = await setup();
    let defaults = 0;
    const config = projectConfiguration(
      host.bb,
      openProjectSettings(host.bb),
      () => ++defaults === 1,
    );
    const rows = await config.listProjectSummaries();
    expect(defaults).toBe(1);
    expect(rows.every((row) => row.enabled && row.enabledOverride === null)).toBe(true);
    expect(host.bb.storage.database().prepare("SELECT * FROM project_settings").all()).toEqual([]);
  });
  it("rejects extra input and prompt text in summary output", async () => {
    const host = await setup();
    await expect(
      host.harness.behavior.callRpc("listProjectSummaries", { extra: true }),
    ).rejects.toThrow();
    const rows = (await host.harness.behavior.callRpc("listProjectSummaries", {})) as object[];
    expect(settingsContract.listProjectSummaries.output.safeParse(rows).success).toBe(true);
    expect(
      settingsContract.listProjectSummaries.output.safeParse([{ ...rows[0], prompt: "private" }])
        .success,
    ).toBe(false);
  });
});
