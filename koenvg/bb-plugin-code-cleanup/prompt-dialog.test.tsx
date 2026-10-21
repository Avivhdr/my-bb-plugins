// @vitest-environment jsdom
import "./dialog-test-support";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type { ProjectState, PromptResult, SettingsContract } from "./rpc";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const source = "  # Saved\n\nLiteral ${HOME}\n";
const factory = "# Factory\nRecord cleanup through BB Tasks.\n";
function state(projectId: string, prompt: string | null = source): ProjectState {
  return {
    projectId,
    prompt,
    effectivePrompt: prompt ?? factory,
    enabled: false,
    enabledOverride: false,
    enableByDefault: true,
  };
}
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
  const states = new Map([
    ["proj_a", state("proj_a")],
    ["proj_b", state("proj_b", null)],
  ]);
  const app = await loadPluginApp(() => import("./app"));
  const view = renderSlot<{}, SettingsContract>(
    app.settingsSections[0],
    {},
    {
      rpc: {
        listProjects: () => [
          { id: "proj_a", name: "Alpha" },
          { id: "proj_b", name: "Beta" },
        ],
        listProjectSummaries: () =>
          [...states].map(([id, s]) => ({
            id,
            name: id === "proj_a" ? "Alpha" : "Beta",
            enabled: s.enabled,
            enabledOverride: s.enabledOverride,
            promptSource: s.prompt === null ? "default" : "custom",
          })),
        getProject: ({ projectId }) => states.get(projectId)!,
        setEnablement: () => {
          throw new Error("Dialog must not write enablement");
        },
        setPrompt: ({ projectId, prompt, expectedPrompt }) => {
          const current = states.get(projectId)!;
          if (current.prompt !== expectedPrompt) return { status: "conflict", state: current };
          const next = { ...current, prompt, effectivePrompt: prompt ?? factory };
          states.set(projectId, next);
          return { status: "saved", state: next };
        },
        ...overrides,
      },
    },
  );
  const trigger = await screen.findByRole("button", { name: "Open cleanup prompt for Alpha" });
  return {
    view,
    states,
    trigger,
    writes: () => view.inspection.rpcCalls.filter((c) => c.method.startsWith("set")),
  };
}
async function open(trigger: HTMLElement) {
  await userEvent.click(trigger);
  return await screen.findByRole("dialog", { name: /Cleanup guidance for/ });
}
async function edit(text: string) {
  const editor = await screen.findByRole("textbox", { name: "Cleanup guidance" });
  await userEvent.clear(editor);
  await userEvent.click(editor);
  if (text) await userEvent.paste(text);
  return editor as HTMLTextAreaElement;
}
function escape(dialog: HTMLElement) {
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
}

describe("project-bound native prompt dialog", () => {
  it("opens read-only from either row control without selector/inline editor, including disabled projects", async () => {
    const client = await mount();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    const modal = await open(client.trigger);
    expect(modal.tagName).toBe("DIALOG");
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe(source);
    expect(screen.getByText("Saved prompt source: Custom")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    expect(client.writes()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(client.trigger));
    const action = screen.getByRole("button", { name: "Edit prompt for Alpha" });
    await open(action);
    await userEvent.click(screen.getByRole("button", { name: "Close cleanup prompt for Alpha" }));
    await waitFor(() => expect(document.activeElement).toBe(action));
  });

  it("preserves exact draft through preview and closes only after a confirmed Save", async () => {
    const client = await mount();
    await open(client.trigger);
    const exact = "  # Draft\n\n`$(echo $HOME)`\n ";
    await edit(exact);
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("region", { name: "Guidance preview" }).textContent).toContain(exact);
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(exact);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(client.writes()).toEqual([
      {
        method: "setPrompt",
        input: { projectId: "proj_a", prompt: exact, expectedPrompt: source },
      },
    ]);
    expect(client.states.get("proj_a")?.enabledOverride).toBe(false);
    expect(client.states.get("proj_b")?.prompt).toBeNull();
  });

  it("retains invalid exact text without writing", async () => {
    const client = await mount();
    await open(client.trigger);
    for (const text of ["", " \n\t", "x".repeat(4097)]) {
      await edit(text);
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).toContain("nonblank");
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(text);
    }
    expect(client.writes()).toEqual([]);
  });

  it.each(["Cancel", "Close", "Escape"])(
    "protects dirty %s in the same dialog with safe focus and no writes",
    async (action) => {
      const client = await mount();
      const modal = await open(client.trigger);
      const editor = await edit("Keep exactly\n");
      const origin =
        action === "Cancel"
          ? screen.getByRole("button", { name: "Cancel" })
          : action === "Close"
            ? screen.getByRole("button", { name: "Close cleanup prompt for Alpha" })
            : editor;
      if (action === "Escape") escape(modal);
      else await userEvent.click(origin);
      const keep = await screen.findByRole("button", { name: "Keep editing" });
      expect(document.activeElement).toBe(keep);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      await userEvent.keyboard("{Escape}");
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep exactly\n");
      expect(document.activeElement).toBe(origin);
      fireEvent.click(modal);
      expect(screen.queryByRole("button", { name: "Keep editing" })).toBeNull();
      escape(modal);
      await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(client.writes()).toEqual([]);
    },
  );

  it("blocks pending dismissal/duplicates, keeps failed drafts and permits explicit retry", async () => {
    const pending = deferred<{ status: "saved"; state: ProjectState }>();
    let calls = 0;
    const client = await mount({
      setPrompt: ({ projectId, prompt }) => {
        if (++calls === 1) return pending.promise;
        return { status: "saved", state: state(projectId, prompt) };
      },
    });
    const modal = await open(client.trigger);
    await edit("Draft");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    escape(modal);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("dialog")).toBe(modal);
    expect(client.writes()).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await act(async () => pending.reject(new Error("offline")));
    expect((await screen.findByRole("alert")).textContent).toContain("offline");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(client.writes()).toHaveLength(2);
  });

  it("confirms immediate Reset, keeps dialog open on factory text, and Cancel does not undo it", async () => {
    const client = await mount();
    await open(client.trigger);
    await edit("Draft");
    const reset = screen.getByRole("button", { name: "Reset to plugin default" });
    await userEvent.click(reset);
    expect(screen.getByText(/Reset saves immediately/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(reset);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Draft");
    await userEvent.click(reset);
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(factory),
    );
    expect(screen.getByText("Saved prompt source: Plugin default")).toBeTruthy();
    expect(client.states.get("proj_a")?.enabledOverride).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(client.writes()).toEqual([
      { method: "setPrompt", input: { projectId: "proj_a", prompt: null, expectedPrompt: source } },
    ]);
    const row = client.trigger.closest("tr")!;
    expect(within(row).getByText("Plugin default")).toBeTruthy();
  });

  it("keeps dirty baseline on external refresh, rejects stale Save and confirms discard before reload", async () => {
    const client = await mount();
    await open(client.trigger);
    await edit("Local draft");
    client.states.set("proj_a", state("proj_a", null));
    await act(async () => {
      await client.view.behavior.emitRealtime("settings.changed", {
        kind: "project",
        projectId: "proj_a",
      });
    });
    await screen.findByText(/Saved settings changed/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Local draft");
    expect(screen.getByText("Saved prompt source: Custom")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText(/Prompt conflict/);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Reload saved settings" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.keyboard("{Escape}");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Local draft");
    await userEvent.click(screen.getByRole("button", { name: "Reload saved settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard and reload" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(factory),
    );
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("ignores project-A responses after close and project-B opening", async () => {
    const late = deferred<ProjectState>();
    const client = await mount({
      getProject: ({ projectId }) =>
        projectId === "proj_a" ? late.promise : state(projectId, null),
    });
    await open(client.trigger);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await open(screen.getByRole("button", { name: "Edit prompt for Beta" }));
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(factory),
    );
    await act(async () => late.resolve(state("proj_a")));
    expect(screen.getByRole("dialog").textContent).toContain("Cleanup guidance for Beta");
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(factory);
  });
  it("keeps the Reset-opening draft and precondition when a clean notification arrives inside confirmation", async () => {
    const client = await mount();
    await open(client.trigger);
    await screen.findByRole("textbox");
    await userEvent.click(screen.getByRole("button", { name: "Reset to plugin default" }));
    client.states.set("proj_a", state("proj_a", "External saved text"));
    await client.view.behavior.emitRealtime("settings.changed", {
      kind: "project",
      projectId: "proj_a",
    });
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    await screen.findByText(/Prompt conflict/);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(source);
    expect(client.writes()).toEqual([
      { method: "setPrompt", input: { projectId: "proj_a", prompt: null, expectedPrompt: source } },
    ]);
    expect(client.states.get("proj_a")?.prompt).toBe("External saved text");
  });

  it.each(["Cancel", "Close", "Escape"])(
    "closes a clean dialog on %s without confirmation or writes",
    async (action) => {
      const client = await mount();
      const modal = await open(client.trigger);
      await screen.findByRole("textbox");
      if (action === "Escape") escape(modal);
      else
        await userEvent.click(
          screen.getByRole("button", {
            name: action === "Close" ? "Close cleanup prompt for Alpha" : "Cancel",
          }),
        );
      expect(screen.queryByRole("dialog")).toBeNull();
      await waitFor(() => expect(document.activeElement).toBe(client.trigger));
      expect(client.writes()).toEqual([]);
    },
  );

  it("blocks all dismissal routes and duplicate Reset while persistence is pending", async () => {
    const gate = deferred<{ status: "saved"; state: ProjectState }>();
    const client = await mount({ setPrompt: () => gate.promise });
    const modal = await open(client.trigger);
    await screen.findByRole("textbox");
    await userEvent.click(screen.getByRole("button", { name: "Reset to plugin default" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    escape(modal);
    for (const name of [
      "Cancel",
      "Close cleanup prompt for Alpha",
      "Reset to plugin default",
      "Save",
    ]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    fireEvent.click(modal);
    expect(screen.getByRole("dialog")).toBe(modal);
    expect(client.writes()).toHaveLength(1);
    await act(async () => gate.resolve({ status: "saved", state: state("proj_a", null) }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(factory);
    expect(screen.getByRole("dialog")).toBe(modal);
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an old closed-instance %s after reopening the same project",
    async (outcome) => {
      const late = deferred<ProjectState>();
      let reads = 0;
      const client = await mount({
        getProject: ({ projectId }) =>
          ++reads === 1 ? late.promise : state(projectId, "Reopened current text"),
      });
      await open(client.trigger);
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      await open(client.trigger);
      await screen.findByRole("textbox");
      await act(async () =>
        outcome === "resolve"
          ? late.resolve(state("proj_a", "Late old text"))
          : late.reject(new Error("Late old failure")),
      );
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        "Reopened current text",
      );
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it("returns focus to the overview heading if a notification removes the opening row", async () => {
    const client = await mount();
    await open(client.trigger);
    await screen.findByRole("textbox");
    client.states.delete("proj_a");
    await client.view.behavior.emitRealtime("settings.changed", {
      kind: "project",
      projectId: "proj_a",
    });
    expect(client.trigger.isConnected).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Saved project settings" }),
      ),
    );
  });
  it("wraps native dialog Tab boundaries without reaching background or browser controls", async () => {
    const visible = vi
      .spyOn(HTMLElement.prototype, "getClientRects")
      .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    try {
      const client = await mount();
      await open(client.trigger);
      await screen.findByRole("textbox");
      const first = screen.getByRole("button", { name: "Close cleanup prompt for Alpha" });
      const last = screen.getByRole("button", { name: "Cancel" });
      last.focus();
      expect(fireEvent.keyDown(last, { key: "Tab" })).toBe(false);
      expect(document.activeElement).toBe(first);
      expect(fireEvent.keyDown(first, { key: "Tab", shiftKey: true })).toBe(false);
      expect(document.activeElement).toBe(last);
    } finally {
      visible.mockRestore();
    }
  });
  it("keeps focus inside when Save becomes pending and then conflicts", async () => {
    const gate = deferred<PromptResult>();
    const client = await mount({ setPrompt: () => gate.promise });
    const dialog = await open(client.trigger);
    await edit("Local draft");
    const title = within(dialog).getByRole("heading", { name: "Cleanup guidance for Alpha" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(document.activeElement).toBe(title);
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
    expect(fireEvent.keyDown(title, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(title);
    await act(async () => {
      gate.resolve({ status: "conflict", state: state("proj_a", "External prompt") });
    });
    await within(dialog).findByText(/Prompt conflict/);
    expect(document.activeElement).toBe(title);
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    const editor = within(dialog).getByRole("textbox", { name: "Cleanup guidance" });
    await userEvent.click(editor);
    await client.view.behavior.emitRealtime("settings.changed", {
      kind: "project",
      projectId: "proj_a",
    });
    expect(document.activeElement).toBe(editor);
  });
});
