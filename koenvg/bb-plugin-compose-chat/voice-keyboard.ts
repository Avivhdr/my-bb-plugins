const FORM = "form[data-promptbox]";
const ACTIVE = "data-promptbox-voice-active";
const CONTROLS = "[data-promptbox-voice-controls]";
const ERROR_TITLE = '[data-testid="app-toast-title"]';
const EDITOR =
  "[data-promptbox-input-region] [contenteditable], [data-promptbox-input-region] textarea";

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]'))
    return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0
  );
}
function modalOpen(): boolean {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]'),
  ).some(visible);
}
function focusedForm(): HTMLFormElement | null {
  if (modalOpen()) return null;
  const target = document.activeElement;
  const form = target?.closest<HTMLFormElement>(FORM);
  if (!form || !visible(form)) return null;
  if (target === form.querySelector(EDITOR)) return form;
  if (target === button(form, "Start voice input")) return form;
  const controls = voiceButtons(form);
  return target === controls.cancel || target === controls.confirm || target === controls.indicator
    ? form
    : null;
}
function editable(form: HTMLFormElement): HTMLElement | null {
  const editor = form.querySelector<HTMLElement>(EDITOR);
  if (!editor || !visible(editor) || editor.getAttribute("aria-readonly") === "true") return null;
  if (editor instanceof HTMLTextAreaElement)
    return editor.disabled || editor.readOnly ? null : editor;
  return editor.getAttribute("contenteditable") === "true" ? editor : null;
}
function button(root: HTMLElement, label: string): HTMLButtonElement | null {
  const matches = Array.from(root.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => button.getAttribute("aria-label") === label,
  );
  const candidate = matches.length === 1 ? matches[0]! : null;
  return candidate &&
    candidate.type === "button" &&
    !candidate.disabled &&
    candidate.getAttribute("aria-disabled") !== "true" &&
    visible(candidate)
    ? candidate
    : null;
}
function voiceButtons(form: HTMLFormElement) {
  const empty = { cancel: null, confirm: null, indicator: null };
  const roots = form.querySelectorAll<HTMLElement>(CONTROLS);
  const root = roots.length === 1 ? roots[0]! : null;
  if (!root || !visible(root)) return empty;
  const cancels = root.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Cancel recording"], button[aria-label="Cancel transcription"]',
  );
  const confirms = root.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Stop and transcribe recording"], button[aria-label="Stop and add to draft"], button[aria-label="Transcribing voice input"]',
  );
  if (cancels.length !== 1 || confirms.length !== 1) return empty;
  const cancelLabel = cancels[0]!.getAttribute("aria-label")!;
  const confirm = confirms[0]!;
  const cancel = button(root, cancelLabel);
  if (!cancel) return empty;
  if (
    cancelLabel === "Cancel recording" &&
    (confirm.getAttribute("aria-label") === "Stop and transcribe recording" ||
      confirm.getAttribute("aria-label") === "Stop and add to draft")
  ) {
    const enabledConfirm = button(root, confirm.getAttribute("aria-label")!);
    return enabledConfirm ? { cancel, confirm: enabledConfirm, indicator: null } : empty;
  }
  if (
    cancelLabel === "Cancel transcription" &&
    (confirm.getAttribute("aria-label") === "Transcribing voice input" ||
      confirm.getAttribute("aria-label") === "Stop and add to draft") &&
    confirm.type === "button" &&
    confirm.disabled &&
    visible(confirm)
  ) {
    return { cancel, confirm: null, indicator: confirm };
  }
  return empty;
}
function voiceErrors(): Set<HTMLElement> {
  return new Set(
    Array.from(document.querySelectorAll<HTMLElement>(ERROR_TITLE)).filter(
      (title) => title.textContent?.trim() === "Voice input failed",
    ),
  );
}

type Session = {
  form: HTMLFormElement;
  keyboard: boolean;
  restore: boolean;
  sawActive: boolean;
  confirmed: boolean;
};

/** Delegate only to BB 0.44/0.45's named native controls. Never own audio or draft data. */
export function createVoiceKeyboardControls() {
  let mounted = false;
  let lastFocused: HTMLFormElement | null = null;
  let session: Session | null = null;
  // A permission request must outlive focus and other composers' Enter sessions.
  let pendingStart: { form: HTMLFormElement; errors: Set<HTMLElement> } | null = null;
  let heldEnter: HTMLFormElement | null = null;
  const metadata = new Map<HTMLButtonElement, { previous: string | null; value: string }>();

  function ownsFocus(form: HTMLFormElement): boolean {
    if (modalOpen() || !visible(form)) return false;
    return (
      focusedForm() === form || (document.activeElement === document.body && lastFocused === form)
    );
  }
  function newSession(form: HTMLFormElement, keyboard: boolean): Session {
    return {
      form,
      keyboard,
      restore: ownsFocus(form),
      sawActive: form.hasAttribute(ACTIVE),
      confirmed: false,
    };
  }
  function hint(control: HTMLButtonElement | null, value: string) {
    if (!control || metadata.has(control)) return;
    const previous = control.getAttribute("aria-keyshortcuts");
    // Do not replace host-owned guidance.
    if (previous !== null) return;
    metadata.set(control, { previous, value });
    control.setAttribute("aria-keyshortcuts", value);
  }
  function restoreHint(
    control: HTMLButtonElement,
    entry: { previous: string | null; value: string },
  ) {
    if (control.getAttribute("aria-keyshortcuts") !== entry.value) return;
    if (entry.previous === null) control.removeAttribute("aria-keyshortcuts");
    else control.setAttribute("aria-keyshortcuts", entry.previous);
  }
  function sync() {
    if (!mounted) return;
    if (pendingStart) {
      const pending = pendingStart;
      if (
        !pending.form.isConnected ||
        pending.form.hasAttribute(ACTIVE) ||
        Array.from(voiceErrors()).some((error) => !pending.errors.has(error))
      ) {
        pendingStart = null;
      }
    }
    for (const [control, entry] of metadata) {
      if (!control.isConnected || !control.closest(`[${ACTIVE}]`)) {
        restoreHint(control, entry);
        metadata.delete(control);
      }
    }
    for (const form of Array.from(
      document.querySelectorAll<HTMLFormElement>(`${FORM}[${ACTIVE}]`),
    )) {
      const controls = voiceButtons(form);
      hint(controls.confirm, "Enter");
      hint(controls.cancel, "Escape");
    }
    if (!session && lastFocused?.hasAttribute(ACTIVE)) session = newSession(lastFocused, false);
    if (!session) return;
    if (!session.form.isConnected) {
      session = null;
      return;
    }
    if (!ownsFocus(session.form)) session.restore = false;
    if (session.form.hasAttribute(ACTIVE)) {
      session.sawActive = true;
      return;
    }
    if (!session.sawActive) {
      // Pending permission is independent of Enter-session ownership. An error
      // or removal releases that guard; unknown host markup stays fail-closed.
      if (pendingStart?.form !== session.form) session = null;
      return;
    }
    const editor = editable(session.form);
    // The native editor may become editable in an effect after voice state ends.
    if (!editor) return;
    const completed = session;
    session = null;
    if (completed.keyboard && completed.restore && ownsFocus(completed.form))
      editor.focus({ preventScroll: true });
  }
  function canStart(): boolean {
    if (!mounted) return false;
    sync();
    const form = focusedForm();
    return (
      !!form &&
      !pendingStart &&
      !session &&
      !document.querySelector(`${FORM}[${ACTIVE}]`) &&
      !!editable(form) &&
      !!button(form, "Start voice input")
    );
  }
  function start() {
    if (!canStart()) return;
    const form = focusedForm()!;
    const mic = button(form, "Start voice input");
    if (!mic) return;
    lastFocused = form;
    pendingStart = { form, errors: voiceErrors() };
    session = newSession(form, true); // Latch before React/native handlers run.
    mic.click();
    sync();
  }
  function focusChanged() {
    const form = focusedForm();
    // Native control removal leaves body focus without a focusin event. An
    // actual focusin elsewhere permanently releases restoration ownership.
    lastFocused = form;
    if (session && form !== session.form) session.restore = false;
    sync();
  }
  function keyDown(event: KeyboardEvent) {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.defaultPrevented
    )
      return;
    sync();
    const form = focusedForm() ?? (lastFocused && ownsFocus(lastFocused) ? lastFocused : null);
    if (
      !form ||
      !(event.target instanceof Node) ||
      (event.target !== document.body && !form.contains(event.target))
    )
      return;
    if (heldEnter === form && event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (!event.repeat) heldEnter = null;
    if (!form.hasAttribute(ACTIVE)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    heldEnter = form;
    if (!session || session.form !== form) session = newSession(form, true);
    session.keyboard = true;
    const controls = voiceButtons(form);
    if (controls.cancel && controls.cancel === document.activeElement && !event.repeat) {
      controls.cancel.click();
      sync();
      return;
    }
    if (!controls.cancel || !controls.confirm || session.confirmed || event.repeat) return;
    session.confirmed = true;
    controls.confirm.click();
    sync();
  }
  function keyUp(event: KeyboardEvent) {
    if (event.key === "Enter") heldEnter = null;
  }

  function mount({ signal }: { signal: AbortSignal }): () => void {
    if (signal.aborted) return () => {};
    mounted = true;
    lastFocused = focusedForm();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: [
        ACTIVE,
        "contenteditable",
        "aria-readonly",
        "aria-label",
        "disabled",
        "hidden",
        "inert",
        "aria-hidden",
        "data-voice-transition",
      ],
    });
    window.addEventListener("keydown", keyDown, true);
    window.addEventListener("keyup", keyUp, true);
    window.addEventListener("focusin", focusChanged, true);
    sync();
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      mounted = false;
      observer.disconnect();
      window.removeEventListener("keydown", keyDown, true);
      window.removeEventListener("keyup", keyUp, true);
      window.removeEventListener("focusin", focusChanged, true);
      signal.removeEventListener("abort", dispose);
      for (const [control, entry] of metadata) restoreHint(control, entry);
      metadata.clear();
      pendingStart = null;
      session = null;
      lastFocused = null;
      heldEnter = null;
    };
    signal.addEventListener("abort", dispose, { once: true });
    return dispose;
  }
  return { mount, canStart, start };
}
