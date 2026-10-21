// @vitest-environment jsdom
import "./dialog-test-support";
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type { ProjectState, ProjectSummary, SettingsContract } from "./rpc";

afterEach(cleanup);
const initial: ProjectSummary[] = [
  { id: "proj_a", name: "Alpha", enabled: true, enabledOverride: true, promptSource: "custom" },
  { id: "proj_b", name: "Beta", enabled: false, enabledOverride: null, promptSource: "default" },
  {
    id: "proj_c",
    name: "Custom disabled",
    enabled: false,
    enabledOverride: false,
    promptSource: "custom",
  },
];
const snapshot = (id: string, enabledOverride: boolean | null = false): ProjectState => ({
  projectId: id,
  enabled: enabledOverride ?? false,
  enabledOverride,
  enableByDefault: false,
  prompt: "Exact saved text",
  effectivePrompt: "Exact saved text",
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function mount(overrides: Partial<PluginRpcTestHandlers<SettingsContract>> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot<{}, SettingsContract>(
    app.settingsSections[0],
    {},
    {
      rpc: {
        listProjects: () => initial.map(({ id, name }) => ({ id, name })),
        listProjectSummaries: () => initial,
        getProject: ({ projectId }) => snapshot(projectId),
        setEnablement: ({ projectId, enabledOverride }) => snapshot(projectId, enabledOverride),
        setPrompt: ({ projectId, prompt }) => ({
          status: "saved",
          state: { ...snapshot(projectId), prompt, effectivePrompt: prompt ?? "Factory" },
        }),
        ...overrides,
      },
    },
  );
}
const toggle = (name: string) =>
  screen.getByRole("switch", { name: `Enable Code Cleanup for ${name}` });
const row = (name: string) =>
  screen.getByRole("button", { name: `Edit prompt for ${name}` }).closest("tr")!;
const mutations = (rendered: Awaited<ReturnType<typeof mount>>) =>
  rendered.inspection.rpcCalls.filter((c) => c.method.startsWith("set"));

describe("saved project overview", () => {
  it("shows five columns, saved sources and disabled custom guidance without writes", async () => {
    const rendered = await mount();
    const table = await screen.findByRole("table", { name: "Saved project settings" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((n) => n.textContent),
    ).toEqual(["Project", "Enabled", "Setting source Enablement only", "Prompt", "Actions"]);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((n) => n.textContent),
    ).toEqual(["Alpha", "Beta", "Custom disabled"]);
    expect(toggle("Alpha").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Custom disabled").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Alpha").textContent).toBe("");
    expect(
      toggle("Alpha")
        .querySelector('[data-icon="On"][data-active="true"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(toggle("Custom disabled").textContent).toBe("");
    expect(
      toggle("Custom disabled")
        .querySelector('[data-icon="Off"][data-active="true"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    const useDefault = within(row("Alpha")).getByRole("button", { name: "Use default for Alpha" });
    expect(useDefault.textContent).toBe("");
    expect(useDefault.querySelector('[data-icon="RotateCcw"]')?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(
      within(table).getByRole("columnheader", { name: "Setting source Enablement only" }),
    ).toBeTruthy();
    expect(within(row("Custom disabled")).getByText("Custom")).toBeTruthy();
    expect(within(row("Beta")).getByText("Plugin default")).toBeTruthy();
    expect(within(row("Beta")).queryByRole("button", { name: /Use default/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(mutations(rendered)).toEqual([]);
  });
  it("explains icon-only state and recovery controls on hover and focus without writes", async () => {
    const rendered = await mount();
    await screen.findByRole("table");
    act(() => toggle("Alpha").focus());
    await screen.findByRole("tooltip", { name: "Code Cleanup is On for Alpha." });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    const useDefault = screen.getByRole("button", { name: "Use default for Alpha" });
    act(() => useDefault.focus());
    await screen.findByRole("tooltip", { name: "Use default for Alpha" });
    await userEvent.keyboard("{Escape}");
    await userEvent.hover(toggle("Custom disabled"));
    await screen.findByRole("tooltip", { name: "Code Cleanup is Off for Custom disabled." });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await userEvent.unhover(toggle("Custom disabled"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(mutations(rendered)).toEqual([]);
  });
  it("shows unknown initial state without switches and recovers only on manual retry", async () => {
    let failed = true;
    const rendered = await mount({
      listProjectSummaries: () => {
        if (failed) throw new Error("offline");
        return initial;
      },
    });
    await screen.findByText(/Settings are unknown/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    failed = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry overview" }));
    await screen.findByRole("table");
    expect(mutations(rendered)).toEqual([]);
  });
  it("shows loading and empty states without invented values", async () => {
    const read = deferred<ProjectSummary[]>();
    const rendered = await mount({ listProjectSummaries: () => read.promise });
    await screen.findByText("Loading project overview…");
    expect(screen.queryByRole("switch")).toBeNull();
    await act(async () => read.resolve([]));
    await screen.findByText("No standard projects are available in the overview.");
    expect(mutations(rendered)).toEqual([]);
  });
  it("keeps icon controls labelled and keyboard-operable", async () => {
    const rendered = await mount();
    await screen.findByRole("table");
    act(() => toggle("Alpha").focus());
    expect(document.activeElement).toBe(toggle("Alpha"));
    await userEvent.keyboard(" ");
    await screen.findByText("Saved settings for Alpha.");
    expect(toggle("Alpha").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Alpha").querySelector('[data-icon="Off"][data-active="true"]')).toBeTruthy();
    const useDefault = screen.getByRole("button", { name: "Use default for Alpha" });
    act(() => useDefault.focus());
    expect(document.activeElement).toBe(useDefault);
    await userEvent.keyboard("{Enter}");
    expect(mutations(rendered)).toEqual([
      { method: "setEnablement", input: { projectId: "proj_a", enabledOverride: false } },
      { method: "setEnablement", input: { projectId: "proj_a", enabledOverride: null } },
    ]);
    expect(screen.queryByRole("button", { name: "Use default for Alpha" })).toBeNull();
  });
  it("serializes all row writes and shows only confirmed values, then permits manual retry", async () => {
    const write = deferred<ProjectState>();
    let first = true;
    const rendered = await mount({
      setEnablement: ({ projectId, enabledOverride }) => {
        if (first) {
          first = false;
          return write.promise;
        }
        return snapshot(projectId, enabledOverride);
      },
    });
    await screen.findByRole("table");
    await userEvent.click(toggle("Alpha"));
    await screen.findByText("Saving for Alpha…");
    expect(toggle("Alpha").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Alpha").querySelector('[data-icon="On"][data-active="true"]')).toBeTruthy();
    expect((toggle("Beta") as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Edit prompt for Beta" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await userEvent.click(toggle("Beta"));
    expect(mutations(rendered)).toEqual([
      { method: "setEnablement", input: { projectId: "proj_a", enabledOverride: false } },
    ]);
    await act(async () => write.reject(new Error("save failed")));
    await screen.findByText(/Could not save settings for Alpha/);
    expect(toggle("Alpha").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Alpha").querySelector('[data-icon="On"][data-active="true"]')).toBeTruthy();
    expect(screen.queryByText("Saved settings for Alpha.")).toBeNull();
    await userEvent.click(toggle("Alpha"));
    await screen.findByText("Saved settings for Alpha.");
    expect(toggle("Alpha").getAttribute("aria-checked")).toBe("false");
    expect(toggle("Alpha").querySelector('[data-icon="Off"][data-active="true"]')).toBeTruthy();
    expect(within(row("Alpha")).getByText("Custom")).toBeTruthy();
    expect(toggle("Beta").getAttribute("aria-checked")).toBe("false");
  });
  it("Use default sends null and changes only the confirmed target", async () => {
    const rendered = await mount();
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Use default for Alpha" }));
    await screen.findByText("Saved settings for Alpha.");
    expect(mutations(rendered)).toEqual([
      { method: "setEnablement", input: { projectId: "proj_a", enabledOverride: null } },
    ]);
    expect(within(row("Alpha")).getByText("Default")).toBeTruthy();
    expect(within(row("Alpha")).getByText("Custom")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Use default for Alpha" })).toBeNull();
    expect(within(row("Custom disabled")).getByText("Project override")).toBeTruthy();
  });
  it("keeps stale saved rows and a prompt draft, blocks stale row writes, and permits explicit recovery", async () => {
    let failed = false;
    const rendered = await mount({
      listProjectSummaries: () => {
        if (failed) throw new Error("refresh offline");
        return initial;
      },
    });
    await screen.findByRole("table");
    await userEvent.click(screen.getByRole("button", { name: "Edit prompt for Alpha" }));
    const editor = await screen.findByRole("textbox", { name: "Cleanup guidance" });
    await userEvent.clear(editor);
    await userEvent.type(editor, "Keep my draft");
    failed = true;
    await rendered.behavior.emitRealtime("settings.changed", {
      kind: "project",
      projectId: "proj_a",
    });
    await screen.findByText(/Last saved values are shown/);
    expect((editor as HTMLTextAreaElement).value).toBe("Keep my draft");
    expect((toggle("Alpha") as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(toggle("Alpha"));
    expect(mutations(rendered)).toEqual([]);
    failed = false;
    await rendered.behavior.emitRealtime("settings.changed", { kind: "default" });
    expect(screen.queryByText(/Last saved values are shown/)).toBeNull();
    expect((editor as HTMLTextAreaElement).value).toBe("Keep my draft");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect((toggle("Alpha") as HTMLButtonElement).disabled).toBe(false);
  });
  it("rejects an older read after a confirmed mutation", async () => {
    const oldRead = deferred<ProjectSummary[]>();
    let reads = 0;
    const confirmed = initial.map((r) => (r.id === "proj_a" ? { ...r, enabled: false } : r));
    const rendered = await mount({
      listProjectSummaries: () =>
        ++reads === 2 ? oldRead.promise : reads > 2 ? confirmed : initial,
    });
    await screen.findByRole("table");
    await rendered.behavior.emitRealtime("settings.changed", { kind: "default" });
    await screen.findByText("Refreshing project overview…");
    await userEvent.click(toggle("Alpha"));
    await screen.findByText("Saved settings for Alpha.");
    await act(async () => oldRead.resolve(initial));
    expect(toggle("Alpha").getAttribute("aria-checked")).toBe("false");
  });
  it("refreshes inherited values on default notifications and saved prompt sources on reconnect", async () => {
    let rows = initial;
    const rendered = await mount({ listProjectSummaries: () => rows });
    await screen.findByRole("table");
    rows = initial.map((r) => (r.enabledOverride === null ? { ...r, enabled: true } : r));
    await rendered.behavior.emitRealtime("settings.changed", { kind: "default" });
    await screen.findByRole("table");
    expect(toggle("Beta").getAttribute("aria-checked")).toBe("true");
    expect(toggle("Custom disabled").getAttribute("aria-checked")).toBe("false");
    await rendered.behavior.setRealtimeConnectionState("reconnecting");
    rows = rows.map((r) => (r.id === "proj_a" ? { ...r, promptSource: "default" } : r));
    await rendered.behavior.setRealtimeConnectionState("connected");
    expect(within(row("Alpha")).getByText("Plugin default")).toBeTruthy();
    expect(mutations(rendered)).toEqual([]);
  });
});
