// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, mountPluginContentScripts } from "@get-bb/plugin-sdk/testing/app";
import appDefinition from "./app.js";
import type { PluginCommandRegistration } from "@get-bb/plugin-sdk/app";

const context = { threadId: "thread", projectId: "project", openPanel: () => false };
const mounts: Array<() => Promise<void>> = [];
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function fixture(version: "0.44" | "0.45" = "0.44") {
  const form = document.createElement("form");
  form.dataset.promptbox = "";
  form.innerHTML = `<div data-promptbox-input-region><div contenteditable="true" role="textbox" tabindex="0">Keep my draft</div></div>
    <button type="button" aria-label="Start voice input">Mic</button>
    <button type="submit" data-promptbox-submit-action>Send</button><span data-attachment>file.txt</span>`;
  document.body.append(form);
  const editor = form.querySelector<HTMLElement>('[role="textbox"]')!;
  const mic = form.querySelector<HTMLButtonElement>('[aria-label="Start voice input"]')!;
  const starts = vi.fn();
  const confirms = vi.fn();
  const voiceSends = vi.fn();
  const cancels = vi.fn();
  const submits = vi.fn();
  mic.onclick = starts;
  form.onsubmit = (event) => {
    event.preventDefault();
    submits();
  };
  // Model the host editor's normal Enter submit path.
  editor.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.defaultPrevented) form.requestSubmit();
  });
  let controls: HTMLDivElement | undefined;
  function active(state: "recording" | "transcribing" = "recording", sending = false) {
    form.dataset.promptboxVoiceActive = "";
    editor.contentEditable = "false";
    editor.setAttribute("aria-readonly", "true");
    controls ??= document.createElement("div");
    controls.dataset.promptboxVoiceControls = "";
    controls.dataset.voiceTransition = "active";
    const draftLabel =
      version === "0.45" ? "Stop and add to draft" : "Stop and transcribe recording";
    controls.innerHTML = `<button type="button" aria-label="${state === "recording" ? "Cancel recording" : "Cancel transcription"}">Cancel</button>
      <button type="button" aria-label="${state === "transcribing" && !sending ? "Transcribing voice input" : draftLabel}" ${state === "transcribing" ? "disabled" : ""}>Confirm</button>
      ${version === "0.45" ? `<button type="button" aria-label="${sending ? "Transcribing and sending" : "Send voice input"}" ${state === "transcribing" ? "disabled" : ""}>Send voice</button>` : ""}`;
    form.append(controls);
    controls.querySelector<HTMLButtonElement>("button")!.onclick = () => {
      cancels();
      finish();
    };
    controls.querySelectorAll<HTMLButtonElement>("button")[1]!.onclick = () => {
      confirms();
      active("transcribing");
    };
    const send = controls.querySelector<HTMLButtonElement>('[aria-label="Send voice input"]');
    if (send)
      send.onclick = () => {
        voiceSends();
        active("transcribing", true);
      };
  }
  function finish(text?: string) {
    form.removeAttribute("data-promptbox-voice-active");
    controls?.remove();
    controls = undefined;
    editor.contentEditable = "true";
    editor.removeAttribute("aria-readonly");
    if (text) editor.append(` ${text}`);
  }
  return { form, editor, mic, starts, confirms, voiceSends, cancels, submits, active, finish };
}
function key(target: EventTarget, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event);
  return event;
}
async function mount() {
  const app = await loadPluginApp(appDefinition);
  const mounted = await mountPluginContentScripts(app, { pluginId: "compose-chat" });
  mounts.push(() => mounted.lifecycle.dispose());
  // The public harness returns validated commands, but omits them from its declaration.
  const commands = (app as typeof app & { commandPaletteActions: PluginCommandRegistration[] })
    .commandPaletteActions;
  const command = commands.find((command) => command.id === "start-voice-input")!;
  return { app, command, mounted };
}
beforeEach(() => {
  // jsdom has no layout. Hidden/inert checks still run in the adapter.
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue({ length: 1 } as DOMRectList);
});
afterEach(async () => {
  for (const dispose of mounts.splice(0)) await dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("Compose Chat voice keyboard controls through the public app boundary", () => {
  it("registers explicit Control, not Mod or Meta, and a public content script", async () => {
    const { app, command } = await mount();
    expect(command?.defaultShortcut).toMatchObject({
      key: "Space",
      control: true,
      shift: true,
      mod: false,
      meta: false,
    });
    expect(app.contentScripts.map((script) => script.id)).toContain("voice-keyboard");
  });
  it("starts once in the focused composer and preserves draft, attachments and editor identity", async () => {
    const f = fixture();
    f.editor.focus();
    const { command } = await mount();
    expect(command.isAvailable?.(context)).toBe(true);
    await command.run(context);
    await command.run(context);
    expect(f.starts).toHaveBeenCalledTimes(1);
    expect(f.editor.textContent).toBe("Keep my draft");
    expect(f.form.querySelector("[data-attachment]")?.textContent).toBe("file.txt");
    expect(f.form.querySelector('[role="textbox"]')).toBe(f.editor);
  });
  it("does not install a hard-coded start key that could bypass an override", async () => {
    const f = fixture();
    f.editor.focus();
    await mount();
    key(f.editor, " ", { ctrlKey: true, shiftKey: true });
    key(f.editor, " ", { metaKey: true, shiftKey: true });
    expect(f.starts).not.toHaveBeenCalled();
  });
  it("does not start outside the composer, in a dialog, a locked editor, or with disabled/unknown controls", async () => {
    const f = fixture();
    const { command } = await mount();
    const other = document.createElement("input");
    document.body.append(other);
    other.focus();
    expect(command.isAvailable?.(context)).toBe(false);
    await command.run(context);
    f.editor.focus();
    f.editor.setAttribute("aria-readonly", "true");
    await command.run(context);
    f.editor.removeAttribute("aria-readonly");
    f.mic.disabled = true;
    await command.run(context);
    f.mic.disabled = false;
    f.mic.setAttribute("aria-label", "Unknown microphone");
    await command.run(context);
    f.mic.setAttribute("aria-label", "Start voice input");
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    await command.run(context);
    expect(f.starts).not.toHaveBeenCalled();
  });
  it.each(["compact", "new-thread"])("supports a %s native composer", async (layout) => {
    const f = fixture();
    if (layout === "compact") f.form.dataset.promptboxCompact = "";
    f.editor.focus();
    const { command } = await mount();
    await command.run(context);
    expect(f.starts).toHaveBeenCalledOnce();
  });
  it("allows retry after a new native voice error, but not after unrelated content or elapsed time", async () => {
    const f = fixture();
    f.editor.focus();
    const { command } = await mount();
    await command.run(context);
    const toast = document.createElement("div");
    toast.dataset.testid = "app-toast-title";
    toast.textContent = "Other error";
    document.body.append(toast);
    await settle();
    await command.run(context);
    expect(f.starts).toHaveBeenCalledOnce();
    const error = document.createElement("div");
    error.dataset.testid = "app-toast-title";
    error.textContent = "Voice input failed";
    document.body.append(error);
    await settle();
    await command.run(context);
    expect(f.starts).toHaveBeenCalledTimes(2);
  });
  it("confirms once, blocks Enter during transcription, restores focus, and requires a new press to send", async () => {
    const f = fixture();
    f.editor.focus();
    const { command } = await mount();
    await command.run(context);
    f.active();
    await settle();
    expect(key(f.editor, "Enter").defaultPrevented).toBe(true);
    expect(f.confirms).toHaveBeenCalledOnce();
    key(f.editor, "Enter", { repeat: true });
    key(f.editor, "Enter");
    expect(f.submits).not.toHaveBeenCalled();
    f.finish("Transcript");
    await settle();
    expect(document.activeElement).toBe(f.editor);
    key(f.editor, "Enter", { repeat: true });
    expect(f.submits).not.toHaveBeenCalled();
    key(f.editor, "Enter");
    expect(f.submits).toHaveBeenCalledOnce();
    expect(f.editor.textContent).toBe("Keep my draft Transcript");
  });
  it("stops BB 0.45 recording into the draft on Enter, never using Send voice input", async () => {
    const f = fixture("0.45");
    f.editor.focus();
    const { command } = await mount();
    await command.run(context);
    f.active();
    await settle();
    const send = f.form.querySelector<HTMLButtonElement>('[aria-label="Send voice input"]')!;
    expect(send.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(key(f.editor, "Enter").defaultPrevented).toBe(true);
    expect(f.confirms).toHaveBeenCalledOnce();
    expect(f.voiceSends).not.toHaveBeenCalled();
    key(f.editor, "Enter");
    expect(f.submits).not.toHaveBeenCalled();
    f.finish("Transcript");
    await settle();
    expect(document.activeElement).toBe(f.editor);
    key(f.editor, "Enter", { repeat: true });
    expect(f.submits).not.toHaveBeenCalled();
    key(f.editor, "Enter");
    expect(f.submits).toHaveBeenCalledOnce();
    expect(f.editor.textContent).toBe("Keep my draft Transcript");
  });
  it("keeps native Send voice input separate and permits cancel during its transcription", async () => {
    const f = fixture("0.45");
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    f.form.querySelector<HTMLButtonElement>('[aria-label="Send voice input"]')!.click();
    await settle();
    expect(f.voiceSends).toHaveBeenCalledOnce();
    expect(key(f.editor, "Enter").defaultPrevented).toBe(true);
    const cancel = f.form.querySelector<HTMLButtonElement>('[aria-label="Cancel transcription"]')!;
    cancel.focus();
    key(cancel, "Enter");
    expect(f.cancels).toHaveBeenCalledOnce();
    expect(f.confirms).not.toHaveBeenCalled();
    expect(f.voiceSends).toHaveBeenCalledOnce();
    expect(f.submits).not.toHaveBeenCalled();
  });
  it.each(["Stop and transcribe recording", "Stop and add to draft"])(
    "rejects ambiguous BB 0.45 draft controls with extra %s",
    async (label) => {
      const f = fixture("0.45");
      f.editor.focus();
      await mount();
      f.active();
      const extra = document.createElement("button");
      extra.type = "button";
      extra.setAttribute("aria-label", label);
      const extraConfirm = vi.fn();
      extra.onclick = extraConfirm;
      f.form.querySelector("[data-promptbox-voice-controls]")!.append(extra);
      await settle();
      key(f.editor, "Enter");
      expect(f.confirms).not.toHaveBeenCalled();
      expect(extraConfirm).not.toHaveBeenCalled();
      expect(f.voiceSends).not.toHaveBeenCalled();
      expect(f.submits).not.toHaveBeenCalled();
    },
  );
  it("latches confirmation before the native state update and survives synchronous completion", async () => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    const confirm = f.form.querySelector<HTMLButtonElement>(
      '[aria-label="Stop and transcribe recording"]',
    )!;
    confirm.onclick = () => {
      f.confirms();
    };
    key(f.editor, "Enter");
    key(f.editor, "Enter");
    expect(f.confirms).toHaveBeenCalledOnce();
    f.finish();
    key(f.editor, "Enter", { repeat: true });
    expect(f.submits).not.toHaveBeenCalled();
  });
  it("allows Enter on the cancel button without requesting a transcript", async () => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    const cancel = f.form.querySelector<HTMLButtonElement>('[aria-label="Cancel recording"]')!;
    cancel.focus();
    key(cancel, "Enter");
    await settle();
    expect(f.cancels).toHaveBeenCalledOnce();
    expect(f.confirms).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(f.editor);
  });
  it("keeps native Escape cancellation unchanged and restores keyboard-session focus", async () => {
    const f = fixture();
    f.editor.focus();
    const { command } = await mount();
    await command.run(context);
    f.active("transcribing");
    await settle();
    const nativeEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        f.cancels();
        f.finish();
      }
    };
    window.addEventListener("keydown", nativeEscape, true);
    try {
      key(f.editor, "Escape");
      await settle();
      expect(f.cancels).toHaveBeenCalledOnce();
      expect(f.submits).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", nativeEscape, true);
    }
  });
  it("does not hijack another composer's Enter or steal focus after the user leaves", async () => {
    const first = fixture();
    const second = fixture();
    first.editor.focus();
    const { command } = await mount();
    await command.run(context);
    first.active();
    await settle();
    second.editor.focus();
    key(second.editor, "Enter");
    expect(first.confirms).not.toHaveBeenCalled();
    expect(second.submits).toHaveBeenCalledOnce();
    first.active("transcribing");
    first.finish("Transcript");
    await settle();
    expect(document.activeElement).toBe(second.editor);
  });
  it("keeps body-focus fallback for replaced native controls, but suspends it for a dialog", async () => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    f.editor.blur();
    expect(key(document.body, "Enter").defaultPrevented).toBe(true);
    expect(f.confirms).toHaveBeenCalledOnce();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(key(document.body, "Enter").defaultPrevented).toBe(false);
    f.finish();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
  it.each([
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
    { keyCode: 229 },
  ])("ignores composing or modified Enter %j", async (options) => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    key(f.editor, "Enter", options);
    expect(f.confirms).not.toHaveBeenCalled();
  });
  it("does not focus a pointer-only session on completion", async () => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    f.editor.blur();
    f.finish();
    await settle();
    expect(document.activeElement).toBe(document.body);
  });
  it("provides reversible shortcut metadata and leaves later host metadata unchanged", async () => {
    const f = fixture();
    f.editor.focus();
    const { mounted } = await mount();
    f.active();
    await settle();
    const confirm = f.form.querySelector<HTMLButtonElement>(
      '[aria-label="Stop and transcribe recording"]',
    )!;
    const cancel = f.form.querySelector<HTMLButtonElement>('[aria-label="Cancel recording"]')!;
    expect(confirm.getAttribute("aria-keyshortcuts")).toBe("Enter");
    expect(cancel.getAttribute("aria-keyshortcuts")).toBe("Escape");
    cancel.setAttribute("aria-keyshortcuts", "Alt+Escape");
    await mounted.lifecycle.dispose();
    expect(confirm.hasAttribute("aria-keyshortcuts")).toBe(false);
    expect(cancel.getAttribute("aria-keyshortcuts")).toBe("Alt+Escape");
  });
  it("fails closed with missing, inert, hidden, or ambiguous voice controls", async () => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    const controls = f.form.querySelector<HTMLElement>("[data-promptbox-voice-controls]")!;
    controls.setAttribute("inert", "");
    key(f.editor, "Enter");
    controls.removeAttribute("inert");
    controls.hidden = true;
    key(f.editor, "Enter");
    controls.hidden = false;
    controls.append(controls.querySelector("button:last-child")!.cloneNode(true));
    key(f.editor, "Enter");
    controls.remove();
    key(f.editor, "Enter");
    expect(f.confirms).not.toHaveBeenCalled();
    expect(f.submits).not.toHaveBeenCalled();
  });
  it("keeps composer A's pending-start guard while composer B's voice session completes", async () => {
    const first = fixture();
    const second = fixture();
    first.editor.focus();
    const { command } = await mount();
    await command.run(context);
    second.active();
    second.editor.focus();
    await settle();
    key(second.editor, "Enter");
    second.finish();
    await settle();
    first.editor.focus();
    expect(command.isAvailable?.(context)).toBe(false);
    await command.run(context);
    expect(first.starts).toHaveBeenCalledOnce();
  });
  it("rejects unrelated nested inputs for both start and recording Enter", async () => {
    const f = fixture();
    const nested = document.createElement("input");
    f.form.append(nested);
    nested.focus();
    const { command } = await mount();
    expect(command.isAvailable?.(context)).toBe(false);
    await command.run(context);
    expect(f.starts).not.toHaveBeenCalled();
    f.active();
    await settle();
    expect(key(nested, "Enter").defaultPrevented).toBe(false);
    expect(f.confirms).not.toHaveBeenCalled();
    f.finish();
    await settle();
    expect(document.activeElement).toBe(nested);
  });
  it.each([
    "both cancel labels",
    "transcription cancel with recording confirm",
    "both confirm labels",
  ])("fails closed with mixed voice state: %s", async (mismatch) => {
    const f = fixture();
    f.editor.focus();
    await mount();
    f.active();
    await settle();
    const controls = f.form.querySelector<HTMLElement>("[data-promptbox-voice-controls]")!;
    if (mismatch === "transcription cancel with recording confirm") {
      controls.querySelector("button")!.setAttribute("aria-label", "Cancel transcription");
    } else {
      const extra = document.createElement("button");
      extra.type = "button";
      extra.setAttribute(
        "aria-label",
        mismatch === "both cancel labels" ? "Cancel transcription" : "Transcribing voice input",
      );
      if (mismatch === "both confirm labels") extra.disabled = true;
      controls.append(extra);
    }
    expect(key(f.editor, "Enter").defaultPrevented).toBe(true);
    expect(f.confirms).not.toHaveBeenCalled();
    expect(f.cancels).not.toHaveBeenCalled();
  });
  it("removes listeners, observer, metadata and start guards on abort and remount", async () => {
    const f = fixture();
    f.editor.focus();
    const { command, mounted } = await mount();
    await command.run(context);
    f.active();
    await settle();
    await mounted.lifecycle.dispose();
    await command.run(context);
    key(f.editor, "Enter");
    expect(f.confirms).not.toHaveBeenCalled();
    f.finish();
    await settle();
    f.editor.focus();
    const next = await mount();
    await next.command.run(context);
    expect(f.starts).toHaveBeenCalledTimes(2);
  });
});
