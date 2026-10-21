// @vitest-environment jsdom
import "./dialog-test-support";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginRpcTestHandlers } from "@get-bb/plugin-sdk/testing/app";
import type { ProjectState, SettingsContract } from "./rpc";

afterEach(cleanup);
const choices = [
  { id: "proj_a", name: "Alpha" },
  { id: "proj_b", name: "Beta" },
];
const source = "  # Saved\n\n`$(name)` and ${HOME}\n";
const state = (projectId: string, prompt: string | null = source): ProjectState => ({
  projectId,
  enabled: false,
  enabledOverride: null,
  enableByDefault: false,
  prompt,
  effectivePrompt: prompt ?? "# Factory\nRecord cleanup through BB Tasks.\n",
});
async function mount(overrides: Partial<PluginRpcTestHandlers<SettingsContract>> = {}) {
  const app = await loadPluginApp(() => import("./app"));
  return renderSlot<{}, SettingsContract>(
    app.settingsSections[0],
    {},
    {
      rpc: {
        listProjects: () => choices,
        listProjectSummaries: () =>
          choices.map(({ id, name }) => ({
            id,
            name,
            enabled: false,
            enabledOverride: null,
            promptSource: "custom",
          })),
        getProject: ({ projectId }) => state(projectId),
        setEnablement: ({ projectId, enabledOverride }) => ({
          ...state(projectId),
          enabledOverride,
          enabled: enabledOverride ?? false,
        }),
        setPrompt: ({ projectId, prompt }) => ({
          status: "saved",
          state: state(projectId, prompt),
        }),
        ...overrides,
      },
    },
  );
}
async function select(name = "Alpha") {
  await userEvent.click(await screen.findByRole("button", { name: `Edit prompt for ${name}` }));
}
async function edit(text: string) {
  const editor = await screen.findByRole("textbox", { name: "Cleanup guidance" });
  await userEvent.clear(editor);
  await userEvent.click(editor);
  await userEvent.paste(text);
  return editor as HTMLTextAreaElement;
}

describe("Markdown prompt editor in its dialog", () => {
  it("keeps named Edit/Preview tooltips and keyboard tabs and the task help disclosure", async () => {
    await mount();
    const help = await screen.findByRole("button", { name: "Task recording requirements" });
    expect(help.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(help);
    expect(
      screen.getByRole("region", { name: "Task recording requirements" }).textContent,
    ).toContain("one linked tracker");
    await userEvent.click(help);
    await select();
    const editTab = await screen.findByRole("tab", { name: "Edit" });
    const previewTab = screen.getByRole("tab", { name: "Preview" });
    expect(editTab.querySelector('[data-icon="Edit"]')).toBeTruthy();
    expect(previewTab.querySelector('[data-icon="Eye"]')).toBeTruthy();
    editTab.focus();
    await screen.findByRole("tooltip", { name: "Edit" });
    expect(fireEvent.keyDown(editTab, { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("tooltip", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(previewTab);
    expect(previewTab.getAttribute("aria-selected")).toBe("true");
    expect(editTab.getAttribute("tabindex")).toBe("-1");
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(editTab);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(previewTab);
  });

  it("retains exact Markdown, literal shell text and inert HTML across Preview, saving while Off", async () => {
    const view = await mount();
    await select();
    expect(((await screen.findByRole("textbox")) as HTMLTextAreaElement).value).toBe(source);
    const draft =
      '  # Draft\n\n- `$(echo "$HOME")`\n<script>alert(1)</script>\n![image](https://example.com/image)\n';
    await edit(draft);
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    const preview = screen.getByRole("region", { name: "Guidance preview" });
    expect(preview.textContent).toContain(draft);
    expect(preview.querySelector("script")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Edit" }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(draft);
    expect(screen.getByText(`${draft.length} / 4096 characters`)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(view.inspection.rpcCalls.filter((call) => call.method === "setPrompt").at(-1)).toEqual({
      method: "setPrompt",
      input: { projectId: "proj_a", prompt: draft, expectedPrompt: source },
    });
    expect(
      screen
        .getByRole("switch", { name: "Enable Code Cleanup for Alpha" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("accepts exactly 4096 JS characters, including surrogate pairs, without trimming", async () => {
    const view = await mount();
    await select();
    const text = " ".repeat(2) + "😀".repeat(2046) + "\n ";
    expect(text.length).toBe(4096);
    await edit(text);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(view.inspection.rpcCalls.filter((c) => c.method === "setPrompt").at(-1)?.input).toEqual({
      projectId: "proj_a",
      prompt: text,
      expectedPrompt: source,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cancelled/failed Reset keeps exact draft and enablement, with manual retry", async () => {
    let fail = true;
    const view = await mount({
      setPrompt: ({ projectId, prompt }) => {
        if (fail) throw new Error("reset failed");
        return { status: "saved", state: state(projectId, prompt) };
      },
    });
    await select();
    const editor = await edit("Unsaved\n");
    const reset = screen.getByRole("button", { name: "Reset to plugin default" });
    await userEvent.click(reset);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(reset);
    expect(editor.value).toBe("Unsaved\n");
    expect(view.inspection.rpcCalls.some((c) => c.method === "setPrompt")).toBe(false);
    await userEvent.click(reset);
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect((await screen.findByRole("alert")).textContent).toContain("reset failed");
    expect(editor.value).toBe("Unsaved\n");
    fail = false;
    await userEvent.click(reset);
    await userEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    await screen.findByText("Reset prompt for Alpha to plugin default.");
    expect(editor.value).toContain("# Factory");
    expect(
      view.inspection.rpcCalls.filter((c) => c.method === "setPrompt").map((c) => c.input),
    ).toEqual([
      { projectId: "proj_a", prompt: null, expectedPrompt: source },
      { projectId: "proj_a", prompt: null, expectedPrompt: source },
    ]);
    expect(
      screen
        .getByRole("switch", { name: "Enable Code Cleanup for Alpha" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});
