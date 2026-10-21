// @vitest-environment jsdom
import "./dialog-test-support";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import type { ProjectState, ProjectSummary, PromptResult, SettingsContract } from "./rpc";

const hosts: Array<ReturnType<typeof createFakePluginHost>["harness"]> = [];
afterEach(async () => {
  cleanup();
  while (hosts.length) await hosts.pop()!.lifecycle.dispose();
});
const choices = [
  { id: "proj_a", name: "Alpha" },
  { id: "proj_b", name: "Beta" },
];
const exact = "  Exact\n\npolicy ";
const state = (projectId: string): ProjectState => ({
  projectId,
  enabled: false,
  enabledOverride: false,
  enableByDefault: false,
  prompt: exact,
  effectivePrompt: exact,
});
const summaries = (enabled = false): ProjectSummary[] =>
  choices.map(({ id, name }) => ({
    id,
    name,
    enabled,
    enabledOverride: null,
    promptSource: "custom",
  }));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount(
  overrides: Partial<PluginRpcTestHandlers<SettingsContract>> = {},
  initialConnection: "connected" | "connecting" = "connected",
) {
  const app = await loadPluginApp(() => import("./app"));
  expect(app.settingsSections).toHaveLength(1);
  return renderSlot<{}, SettingsContract>(
    app.settingsSections[0],
    {},
    {
      realtimeConnectionState: initialConnection,
      rpc: {
        listProjects: () => choices,
        listProjectSummaries: () => summaries(),
        getProject: ({ projectId }) => state(projectId),
        setPrompt: ({ projectId, prompt }) => ({
          status: "saved",
          state: { ...state(projectId), prompt, effectivePrompt: prompt ?? "Factory guidance" },
        }),
        setEnablement: ({ projectId, enabledOverride }) => ({
          ...state(projectId),
          enabledOverride,
          enabled: enabledOverride ?? false,
        }),
        ...overrides,
      },
    },
  );
}
async function open(name = "Alpha") {
  await userEvent.click(await screen.findByRole("button", { name: `Edit prompt for ${name}` }));
}
const toggle = () => screen.getByRole("switch", { name: "Enable Code Cleanup for Alpha" });

describe("project Settings", () => {
  it.each(["first connection", "default notification", "reconnect"])(
    "refreshes the saved overview on %s without replacing a dialog draft",
    async (reason) => {
      let enableByDefault = false;
      const view = await mount(
        {
          listProjectSummaries: () => summaries(enableByDefault),
          getProject: ({ projectId }) => ({
            ...state(projectId),
            enabled: enableByDefault,
            enabledOverride: null,
            enableByDefault,
          }),
        },
        reason === "first connection" ? "connecting" : "connected",
      );
      await open();
      const editor = await screen.findByRole("textbox");
      await userEvent.clear(editor);
      await userEvent.type(editor, "Keep exact draft");
      if (reason === "reconnect") await view.behavior.setRealtimeConnectionState("reconnecting");
      enableByDefault = true;
      if (reason === "default notification")
        await view.behavior.emitRealtime("settings.changed", { kind: "default" });
      else await view.behavior.setRealtimeConnectionState("connected");
      expect(toggle().getAttribute("aria-checked")).toBe("true");
      expect((editor as HTMLTextAreaElement).value).toBe("Keep exact draft");
      expect(view.inspection.rpcCalls.filter((c) => c.method.startsWith("set"))).toEqual([]);
    },
  );

  it("replaces a late initial dialog read after a default notification", async () => {
    const initial = deferred<ProjectState>();
    let reads = 0;
    const view = await mount({
      getProject: ({ projectId }) =>
        ++reads === 1
          ? initial.promise
          : { ...state(projectId), prompt: "Latest", effectivePrompt: "Latest" },
    });
    await open();
    await screen.findByText("Loading project settings…");
    await view.behavior.emitRealtime("settings.changed", { kind: "default" });
    await act(async () => initial.resolve(state("proj_a")));
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("Latest");
  });

  it("opens read-only then saves and resets exact text through the registered host without changing enablement", async () => {
    const host = createFakePluginHost({
      pluginId: "code-cleanup",
      sdk: {
        projects: {
          list: async () =>
            [
              ...choices.map((p) => ({ ...p, kind: "standard" })),
              { id: "personal", name: "Personal", kind: "personal" },
            ] as never,
        },
      },
    });
    hosts.push(host.harness);
    await plugin(host.bb);
    const call = host.harness.behavior.callRpc;
    await call("setPrompt", { projectId: "proj_a", prompt: exact, expectedPrompt: null });
    const before = host.bb.storage.database().prepare("SELECT * FROM project_settings").all();
    const view = await mount({
      listProjects: async () => (await call("listProjects", {})) as typeof choices,
      listProjectSummaries: async () =>
        (await call("listProjectSummaries", {})) as ProjectSummary[],
      getProject: async (input) => (await call("getProject", input)) as ProjectState,
      setEnablement: async (input) => (await call("setEnablement", input)) as ProjectState,
      setPrompt: async (input) => (await call("setPrompt", input)) as PromptResult,
    });
    await screen.findByRole("table");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Personal")).toBeNull();
    expect(view.inspection.rpcCalls.map((c) => c.method)).toEqual(["listProjectSummaries"]);
    await open();
    let editor = await screen.findByRole("textbox");
    expect((editor as HTMLTextAreaElement).value).toBe(exact);
    expect(host.bb.storage.database().prepare("SELECT * FROM project_settings").all()).toEqual(
      before,
    );
    const draft = '  # Custom\n\n`$(echo "$HOME")` and ${literal}\n';
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste(draft);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(view.inspection.rpcCalls.filter((c) => c.method === "setPrompt").at(-1)?.input).toEqual({
      projectId: "proj_a",
      prompt: draft,
      expectedPrompt: exact,
    });
    expect(await call("getProject", { projectId: "proj_a" })).toMatchObject({
      enabled: false,
      enabledOverride: null,
      prompt: draft,
    });
    await open();
    editor = await screen.findByRole("textbox");
    await userEvent.click(screen.getByRole("button", { name: "Reset to plugin default" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    await screen.findByText("Reset prompt for Alpha to plugin default.");
    expect(view.inspection.rpcCalls.filter((c) => c.method === "setPrompt").at(-1)?.input).toEqual({
      projectId: "proj_a",
      prompt: null,
      expectedPrompt: draft,
    });
    expect(await call("getProject", { projectId: "proj_a" })).toMatchObject({
      enabled: false,
      enabledOverride: null,
      prompt: null,
    });
    expect((editor as HTMLTextAreaElement).value).toContain("Record substantial");
    expect(await call("getProject", { projectId: "proj_b" })).toMatchObject({
      enabledOverride: null,
      prompt: null,
    });
  });

  it("blocks writes on unknown dialog state, permits retry and isolates a late closed project read", async () => {
    const late = deferred<ProjectState>();
    let aReads = 0;
    await mount({
      getProject: ({ projectId }) => {
        if (projectId === "proj_a") {
          if (++aReads === 1) throw new Error("read failed");
          return late.promise;
        }
        return { ...state(projectId), effectivePrompt: "Beta guidance", prompt: null };
      },
    });
    await open();
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Retry project" }));
    await screen.findByText("Loading project settings…");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await open("Beta");
    await screen.findByRole("textbox");
    await act(async () => late.resolve(state("proj_a")));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Beta guidance");
    expect(screen.getByText("Saved prompt source: Plugin default")).toBeTruthy();
  });
});
