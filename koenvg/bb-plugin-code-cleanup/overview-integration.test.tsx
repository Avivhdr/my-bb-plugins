// @vitest-environment jsdom
import "./dialog-test-support";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type { ProjectState, ProjectSummary, PromptResult, SettingsContract } from "./rpc";
import plugin from "./server";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  cleanup();
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});
const choices = [
  { id: "proj_c", name: "Charlie" },
  { id: "proj_b", name: "Beta" },
  { id: "proj_a", name: "Alpha" },
];
const exact = "  Exact\n\npolicy ";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function setup() {
  let unavailable = false;
  const host = createFakePluginHost({
    pluginId: "code-cleanup",
    sdk: {
      projects: {
        list: async () => {
          if (unavailable) throw new Error("project service unavailable");
          return choices.map((p) => ({ ...p, kind: "standard" })) as never;
        },
      },
    },
  });
  hosts.push(host.harness);
  await plugin(host.bb);
  const call = host.harness.behavior.callRpc;
  await call("setEnablement", { projectId: "proj_a", enabledOverride: true });
  await call("setEnablement", { projectId: "proj_c", enabledOverride: false });
  for (const projectId of ["proj_a", "proj_c"])
    await call("setPrompt", { projectId, prompt: exact, expectedPrompt: null });
  const handlers: PluginRpcTestHandlers<SettingsContract> = {
    listProjects: async (input) => (await call("listProjects", input)) as typeof choices,
    listProjectSummaries: async (input) =>
      (await call("listProjectSummaries", input)) as ProjectSummary[],
    getProject: async (input) => (await call("getProject", input)) as ProjectState,
    setEnablement: async (input) => (await call("setEnablement", input)) as ProjectState,
    setPrompt: async (input) => (await call("setPrompt", input)) as PromptResult,
  };
  const db = host.bb.storage.database();
  return {
    host,
    handlers,
    call,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    stored: () => db.prepare("SELECT * FROM project_settings ORDER BY project_id").all(),
  };
}
async function mount(handlers: PluginRpcTestHandlers<SettingsContract>) {
  const app = await loadPluginApp(() => import("./app"));
  const view = renderSlot<{}, SettingsContract>(app.settingsSections[0], {}, { rpc: handlers });
  const ui = within(view.container);
  return {
    view,
    ui,
    toggle: (name: string) =>
      ui.getByRole("switch", { name: `Enable Code Cleanup for ${name}` }) as HTMLButtonElement,
    row: (name: string) =>
      within(ui.getByRole("button", { name: `Edit prompt for ${name}` }).closest("tr")!),
    mutations: () => view.inspection.rpcCalls.filter((c) => c.method.startsWith("set")),
  };
}
async function edit(client: Awaited<ReturnType<typeof mount>>, name: string, text: string) {
  await userEvent.click(client.ui.getByRole("button", { name: `Edit prompt for ${name}` }));
  const editor = (await client.ui.findByRole("textbox", {
    name: "Cleanup guidance",
  })) as HTMLTextAreaElement;
  await userEvent.clear(editor);
  await userEvent.click(editor);
  await userEvent.paste(text);
  return editor;
}
async function notify(
  client: Awaited<ReturnType<typeof mount>>,
  server: Awaited<ReturnType<typeof setup>>,
) {
  const signal = server.host.harness.inspection.realtimeSignals.at(-1)!;
  await client.view.behavior.emitRealtime(signal.channel, signal.payload);
}
async function cli(server: Awaited<ReturnType<typeof setup>>, args: string[]) {
  expect(await server.host.harness.behavior.runCli(args)).toMatchObject({ exitCode: 0 });
}

describe("registered-host overview integration", () => {
  it("keeps reads read-only and refreshes default, CLI sources and missed changes without losing a draft", async () => {
    const server = await setup();
    const before = server.stored();
    const client = await mount(server.handlers);
    await client.ui.findByRole("table");
    expect(client.ui.getAllByRole("rowheader").map((n) => n.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Charlie",
    ]);
    expect(server.stored()).toEqual(before);
    expect(client.mutations()).toEqual([]);
    const draft = await edit(client, "Charlie", "Keep my exact\ndraft ");
    await server.host.harness.behavior.setSettings({ enableByDefault: true });
    await notify(client, server);
    expect(client.toggle("Beta").getAttribute("aria-checked")).toBe("true");
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("true");
    expect(client.toggle("Charlie").getAttribute("aria-checked")).toBe("false");
    await cli(server, ["disable", "--project", "proj_a"]);
    await notify(client, server);
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("false");
    await cli(server, ["prompt", "reset", "--project", "proj_c"]);
    await notify(client, server);
    expect(client.row("Charlie").getByText("Plugin default")).toBeTruthy();
    expect(draft.value).toBe("Keep my exact\ndraft ");
    await client.view.behavior.setRealtimeConnectionState("reconnecting");
    await cli(server, ["enablement", "reset", "--project", "proj_c"]);
    await cli(server, ["prompt", "set", "--project", "proj_b", "--text", "CLI\n"]);
    await client.view.behavior.setRealtimeConnectionState("connected");
    expect(client.toggle("Charlie").getAttribute("aria-checked")).toBe("true");
    expect(client.row("Charlie").getByText("Default")).toBeTruthy();
    expect(client.row("Beta").getByText("Custom")).toBeTruthy();
    expect(draft.value).toBe("Keep my exact\ndraft ");
    expect(await server.call("getProject", { projectId: "proj_a" })).toMatchObject({
      prompt: exact,
    });
    expect(client.mutations()).toEqual([]);
  });

  it("serializes row writes before editor opening and preserves prompts/unrelated rows", async () => {
    const server = await setup();
    const gate = deferred<void>();
    const client = await mount({
      ...server.handlers,
      setEnablement: async (input) => {
        await gate.promise;
        return server.handlers.setEnablement!(input);
      },
    });
    await client.ui.findByRole("table");
    const other = await server.call("getProject", { projectId: "proj_c" });
    await userEvent.click(client.toggle("Alpha"));
    await client.ui.findByText("Saving for Alpha…");
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("true");
    expect(client.toggle("Beta").disabled).toBe(true);
    await userEvent.click(client.ui.getByRole("button", { name: "Edit prompt for Beta" }));
    expect(client.ui.queryByRole("dialog")).toBeNull();
    await userEvent.click(client.toggle("Beta"));
    expect(client.mutations()).toEqual([
      { method: "setEnablement", input: { projectId: "proj_a", enabledOverride: false } },
    ]);
    await act(async () => gate.resolve());
    await client.ui.findByText("Saved settings for Alpha.");
    expect(await server.call("getProject", { projectId: "proj_a" })).toMatchObject({
      enabled: false,
      prompt: exact,
    });
    expect(await server.call("getProject", { projectId: "proj_c" })).toEqual(other);
    await userEvent.click(client.ui.getByRole("button", { name: "Use default for Alpha" }));
    expect(client.row("Alpha").getByText("Default")).toBeTruthy();
    expect(client.row("Alpha").getByText("Custom")).toBeTruthy();
    expect(await server.call("getProject", { projectId: "proj_a" })).toMatchObject({
      enabledOverride: null,
      prompt: exact,
    });
    const draft = await edit(client, "Alpha", "Unsaved\neditor draft");
    await cli(server, ["enable", "--project", "proj_a"]);
    await notify(client, server);
    expect(draft.value).toBe("Unsaved\neditor draft");
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("true");
  });

  it("blocks row writes during an editor save and updates the saved source only after confirmation", async () => {
    const server = await setup();
    const gate = deferred<void>();
    const client = await mount({
      ...server.handlers,
      setPrompt: async (input) => {
        await gate.promise;
        return server.handlers.setPrompt!(input);
      },
    });
    await client.ui.findByRole("table");
    const draft = await edit(client, "Beta", "  Exact new\nprompt ");
    await userEvent.click(client.ui.getByRole("button", { name: "Save" }));
    expect(client.toggle("Alpha").disabled).toBe(true);
    expect(client.row("Beta").getByText("Plugin default")).toBeTruthy();
    await userEvent.click(client.toggle("Alpha"));
    expect(client.mutations()).toEqual([
      {
        method: "setPrompt",
        input: { projectId: "proj_b", prompt: draft.value, expectedPrompt: null },
      },
    ]);
    await act(async () => gate.resolve());
    expect(client.ui.queryByRole("dialog")).toBeNull();
    expect(client.row("Beta").getByText("Custom")).toBeTruthy();
    expect(client.toggle("Alpha").disabled).toBe(false);
    expect(await server.call("getProject", { projectId: "proj_b" })).toMatchObject({
      prompt: "  Exact new\nprompt ",
      enabledOverride: null,
    });
    expect(await server.call("getProject", { projectId: "proj_a" })).toMatchObject({
      prompt: exact,
      enabledOverride: true,
    });
  });

  it("retains known rows and dirty text through a host read failure until explicit retry", async () => {
    const server = await setup();
    const client = await mount(server.handlers);
    await client.ui.findByRole("table");
    const draft = await edit(client, "Alpha", "Keep failed-read\ndraft");
    server.setUnavailable(true);
    await server.host.harness.behavior.setSettings({ enableByDefault: true });
    await notify(client, server);
    await client.ui.findByText(/Last saved values are shown/);
    expect(client.toggle("Beta").getAttribute("aria-checked")).toBe("false");
    expect(client.toggle("Alpha").disabled).toBe(true);
    await userEvent.click(client.toggle("Alpha"));
    expect(client.mutations()).toEqual([]);
    expect(draft.value).toBe("Keep failed-read\ndraft");
    server.setUnavailable(false);
    await client.view.behavior.emitRealtime("settings.changed", { kind: "default" });
    expect(client.toggle("Beta").getAttribute("aria-checked")).toBe("true");
    expect(draft.value).toBe("Keep failed-read\ndraft");
    await userEvent.click(client.ui.getByRole("button", { name: "Cancel" }));
    await userEvent.click(client.ui.getByRole("button", { name: "Discard changes" }));
    expect(client.toggle("Alpha").disabled).toBe(false);
    expect(client.mutations()).toEqual([]);
  });

  it("retains confirmed values on host write rejection and recovers only on manual retry", async () => {
    const server = await setup();
    const client = await mount(server.handlers);
    await client.ui.findByRole("table");
    const before = server.stored();
    server.setUnavailable(true);
    await userEvent.click(client.toggle("Alpha"));
    await client.ui.findByText(/Could not save settings for Alpha/);
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("true");
    expect(client.row("Alpha").getByText("Custom")).toBeTruthy();
    expect(server.stored()).toEqual(before);
    expect(client.ui.queryByText("Saved settings for Alpha.")).toBeNull();
    server.setUnavailable(false);
    await userEvent.click(client.toggle("Alpha"));
    await client.ui.findByText("Saved settings for Alpha.");
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("false");
    expect(await server.call("getProject", { projectId: "proj_a" })).toMatchObject({
      prompt: exact,
    });
    expect(client.mutations()).toHaveLength(2);
  });

  it("lets reconnect replace an in-flight summary read without a late rollback", async () => {
    const server = await setup();
    const gate = deferred<void>();
    let reads = 0;
    const client = await mount({
      ...server.handlers,
      listProjectSummaries: async (input) => {
        const result = await server.handlers.listProjectSummaries!(input);
        if (++reads === 2) await gate.promise;
        return result;
      },
    });
    await client.ui.findByRole("table");
    await notify(client, server);
    await client.ui.findByText("Refreshing project overview…");
    await client.view.behavior.setRealtimeConnectionState("reconnecting");
    await cli(server, ["disable", "--project", "proj_a"]);
    await client.view.behavior.setRealtimeConnectionState("connected");
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("false");
    await act(async () => gate.resolve());
    expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("false");
    expect(client.mutations()).toEqual([]);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an obsolete host read that later %ss after a confirmed mutation",
    async (outcome) => {
      const server = await setup();
      const gate = deferred<void>();
      let reads = 0;
      const client = await mount({
        ...server.handlers,
        listProjectSummaries: async (input) => {
          const result = await server.handlers.listProjectSummaries!(input);
          if (++reads === 2) await gate.promise;
          return result;
        },
      });
      await client.ui.findByRole("table");
      await notify(client, server);
      await client.ui.findByText("Refreshing project overview…");
      await userEvent.click(client.toggle("Alpha"));
      await client.ui.findByText("Saved settings for Alpha.");
      await act(async () =>
        outcome === "resolve" ? gate.resolve() : gate.reject(new Error("obsolete failure")),
      );
      expect(client.toggle("Alpha").getAttribute("aria-checked")).toBe("false");
      expect(client.ui.queryByText(/Last saved values are shown/)).toBeNull();
      expect(await server.call("getProject", { projectId: "proj_a" })).toMatchObject({
        enabled: false,
        prompt: exact,
      });
      expect(reads).toBeGreaterThanOrEqual(3);
    },
  );
  it.each(["failed Save", "conflicting Save", "failed Reset"] as const)(
    "resumes an overview refresh interrupted by %s and ignores its late result",
    async (outcome) => {
      const server = await setup();
      const summaryGate = deferred<ProjectSummary[]>();
      const writeGate = deferred<void>();
      let summaryCalls = 0;
      const client = await mount({
        ...server.handlers,
        listProjectSummaries: async (input) => {
          ++summaryCalls;
          if (summaryCalls === 2) return summaryGate.promise;
          return server.handlers.listProjectSummaries!(input);
        },
        setPrompt: async (input) => {
          await writeGate.promise;
          if (outcome === "conflicting Save") return server.handlers.setPrompt!(input);
          throw new Error("write transport failed");
        },
      });
      await client.ui.findByRole("button", { name: "Edit prompt for Alpha" });
      await edit(client, "Alpha", "Local draft");
      const oldRows = (await server.call("listProjectSummaries", {})) as ProjectSummary[];
      await client.view.behavior.emitRealtime("settings.changed", { kind: "default" });
      await client.ui.findByText("Refreshing project overview…");
      expect(summaryCalls).toBe(2);
      await server.call("setPrompt", {
        projectId: "proj_b",
        prompt: "New Beta policy",
        expectedPrompt: null,
      });
      if (outcome === "conflicting Save") {
        await server.call("setPrompt", {
          projectId: "proj_a",
          prompt: "Competing Alpha policy",
          expectedPrompt: exact,
        });
      }
      await userEvent.click(
        client.ui.getByRole("button", {
          name: outcome === "failed Reset" ? "Reset to plugin default" : "Save",
        }),
      );
      if (outcome === "failed Reset")
        await userEvent.click(client.ui.getByRole("button", { name: "Confirm reset" }));
      expect(client.ui.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      await act(async () => {
        writeGate.resolve();
      });
      await client.ui.findByText(
        outcome === "conflicting Save" ? /Prompt conflict/ : /write transport failed/,
      );
      await client.row("Beta").findByText("Custom");
      expect(summaryCalls).toBe(3);
      expect(client.ui.queryByText("Refreshing project overview…")).toBeNull();
      expect(
        (client.ui.getByRole("textbox", { name: "Cleanup guidance" }) as HTMLTextAreaElement).value,
      ).toBe("Local draft");
      await act(async () => {
        summaryGate.resolve(oldRows);
      });
      expect(client.row("Beta").getByRole("cell", { name: "Custom" })).toBeTruthy();
      expect(client.ui.queryByText("Refreshing project overview…")).toBeNull();
    },
  );
});
