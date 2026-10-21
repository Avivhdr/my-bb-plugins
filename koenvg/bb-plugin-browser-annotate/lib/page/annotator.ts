export interface PagePin {
  id: string;
  number: number;
  comment: string;
  rect: { x: number; y: number; width: number; height: number };
  isFixed: boolean;
}

export interface PageTheme {
  surface: string;
  text: string;
  mutedText: string;
  border: string;
  input: string;
  accent: string;
  accentText: string;
  ring: string;
  danger: string;
  font: string;
}

export interface AnnotatorApi {
  ping(): void;
  setTheme(theme: PageTheme): void;
  setMode(on: boolean): void;
  setPins(pins: PagePin[]): void;
  saved(): void;
  saveFailed(message: string): void;
  hide(): Promise<void>;
  show(): void;
  teardown(): void;
}

export const ANNOTATOR_GLOBAL = "__bbBrowserAnnotate";

// Serialized with Function.prototype.toString and evaluated in the page, so it
// must not reference anything outside its own body.
export function installAnnotator(
  win: Window & { __bbBrowserAnnotate?: AnnotatorApi },
  post: (message: unknown) => void,
  shadowMode: ShadowRootMode = "closed",
): AnnotatorApi {
  win.__bbBrowserAnnotate?.teardown();

  const doc = win.document;
  const DRAG_THRESHOLD = 6;
  const MAX_COMMENT = 4000;
  type Box = { x: number; y: number; width: number; height: number };
  type Selection = { kind: string; pageRect: Box; isFixed: boolean };

  const host = doc.createElement("bb-browser-annotate");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; display: block;";
  const root = host.attachShadow({ mode: shadowMode });
  root.innerHTML = `<style>
    :host {
      --bba-surface: #fff; --bba-text: #18181b; --bba-mutedText: #71717a; --bba-border: #e4e4e7;
      --bba-input: #fff; --bba-accent: #18181b; --bba-accentText: #fafafa; --bba-ring: #a1a1aa;
      --bba-danger: #dc2626; --bba-font: system-ui, -apple-system, sans-serif;
    }
    * { box-sizing: border-box; font: 13px/1.4 var(--bba-font); }
    .layer { position: fixed; inset: 0; pointer-events: auto; cursor: crosshair; }
    .highlight { position: fixed; pointer-events: none; border: 2px solid #fff;
      box-shadow: 0 0 0 1px rgba(0,0,0,.85), 0 0 0 4px rgba(0,0,0,.25); border-radius: 2px; }
    .tag { position: fixed; pointer-events: none; padding: 2px 6px; border-radius: 4px; background: rgba(17,17,20,.92);
      color: #fff; font-size: 11px; white-space: nowrap; }
    .drag { position: fixed; pointer-events: none; border: 2px dashed #fff; outline: 1px solid rgba(0,0,0,.85);
      background: rgba(0,0,0,.06); }
    .pin-box { position: fixed; pointer-events: none; border: 2px dashed var(--bba-accent); border-radius: 2px;
      outline: 1px solid color-mix(in srgb, var(--bba-accentText) 70%, transparent); }
    .pin { position: fixed; pointer-events: auto; cursor: pointer; min-width: 22px; height: 22px; padding: 0 6px;
      border: 2px solid var(--bba-accentText); border-radius: 11px; background: var(--bba-accent); color: var(--bba-accentText);
      font-weight: 600; font-size: 12px; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 1px 4px rgba(0,0,0,.3); }
    .form { position: fixed; pointer-events: auto; width: 300px; padding: 10px; border-radius: 10px;
      background: var(--bba-surface); color: var(--bba-text); border: 1px solid var(--bba-border);
      box-shadow: 0 8px 24px rgba(0,0,0,.18); cursor: auto; }
    .form textarea { width: 100%; min-height: 64px; resize: vertical; padding: 6px 8px; border-radius: 6px;
      border: 1px solid var(--bba-border); background: var(--bba-input); color: var(--bba-text); outline: none; }
    .form textarea:focus { border-color: var(--bba-ring); box-shadow: 0 0 0 1px var(--bba-ring); }
    .row { display: flex; gap: 6px; justify-content: flex-end; align-items: center; margin-top: 8px; }
    .hint { margin-right: auto; color: var(--bba-mutedText); font-size: 11px; }
    .error { color: var(--bba-danger); font-size: 12px; margin-top: 6px; }
    button { border: 1px solid var(--bba-border); background: transparent; color: var(--bba-text); border-radius: 6px;
      padding: 4px 10px; cursor: pointer; }
    button:hover { background: color-mix(in srgb, var(--bba-text) 6%, transparent); }
    button.primary { background: var(--bba-accent); border-color: var(--bba-accent); color: var(--bba-accentText); }
    button.primary:hover { background: color-mix(in srgb, var(--bba-accent) 88%, var(--bba-surface)); }
    button.danger { color: var(--bba-danger); }
    button:disabled { opacity: .5; cursor: default; }
  </style><div class="pins"></div>`;
  const pinsLayer = root.querySelector(".pins") as HTMLDivElement;
  doc.documentElement.appendChild(host);

  let modeOn = false;
  let pins: PagePin[] = [];
  let layer: HTMLDivElement | null = null;
  let highlight: HTMLDivElement | null = null;
  let tag: HTMLDivElement | null = null;
  let dragBox: HTMLDivElement | null = null;
  let hovered: Element | null = null;
  let pointerStart: { x: number; y: number } | null = null;
  type Form = { submit(): void; dismiss(): void; showError(message: string): void; close(): void };
  let form: Form | null = null;
  let pendingSave: Form | null = null;
  let frame = 0;

  const element = <K extends keyof HTMLElementTagNameMap>(name: K, className: string) => {
    const created = doc.createElement(name);
    created.className = className;
    return created;
  };
  const place = (node: HTMLElement, box: Box) => {
    node.style.left = `${box.x}px`;
    node.style.top = `${box.y}px`;
    node.style.width = `${box.width}px`;
    node.style.height = `${box.height}px`;
  };
  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight });
  const clipToViewport = (box: Box): Box => {
    const { width, height } = viewport();
    const left = Math.max(0, box.x);
    const top = Math.max(0, box.y);
    const right = Math.min(width, box.x + box.width);
    const bottom = Math.min(height, box.y + box.height);
    return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  const toPage = (box: Box, isFixed: boolean): Box =>
    isFixed ? box : { ...box, x: box.x + win.scrollX, y: box.y + win.scrollY };
  const toViewport = (box: Box, isFixed: boolean): Box =>
    isFixed ? box : { ...box, x: box.x - win.scrollX, y: box.y - win.scrollY };
  const isFixedElement = (target: Element | null) => {
    for (let node = target; node && node !== doc.documentElement; node = node.parentElement) {
      const position = win.getComputedStyle(node).position;
      if (position === "fixed" || position === "sticky") return true;
    }
    return false;
  };

  function elementAt(x: number, y: number): Element | null {
    host.style.display = "none";
    const found = doc.elementFromPoint(x, y);
    host.style.display = "block";
    return found && found !== host ? found : null;
  }

  function clearHover() {
    hovered = null;
    highlight?.remove();
    tag?.remove();
    highlight = null;
    tag = null;
  }

  function showHover(target: Element) {
    hovered = target;
    const rect = target.getBoundingClientRect();
    highlight ??= root.appendChild(element("div", "highlight"));
    tag ??= root.appendChild(element("div", "tag"));
    place(highlight, { x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    tag.textContent = `${target.tagName.toLowerCase()} ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    tag.style.left = `${Math.max(0, rect.left)}px`;
    tag.style.top = `${rect.top >= 22 ? rect.top - 22 : rect.bottom + 4}px`;
  }

  function onPointerMove(event: PointerEvent) {
    if (form) return;
    if (pointerStart) {
      const dx = event.clientX - pointerStart.x;
      const dy = event.clientY - pointerStart.y;
      if (dragBox || Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD) {
        clearHover();
        dragBox ??= root.appendChild(element("div", "drag"));
        place(dragBox, {
          x: Math.min(pointerStart.x, event.clientX),
          y: Math.min(pointerStart.y, event.clientY),
          width: Math.abs(dx),
          height: Math.abs(dy),
        });
        return;
      }
    }
    const target = elementAt(event.clientX, event.clientY);
    if (target) showHover(target);
    else clearHover();
  }

  function onPointerDown(event: PointerEvent) {
    event.preventDefault();
    if (form || event.button !== 0) return;
    pointerStart = { x: event.clientX, y: event.clientY };
  }

  function onPointerUp(event: PointerEvent) {
    event.preventDefault();
    if (!pointerStart || form) return;
    const start = pointerStart;
    pointerStart = null;
    let selection: Selection | null = null;
    if (dragBox) {
      dragBox.remove();
      dragBox = null;
      const box = clipToViewport({
        x: Math.min(start.x, event.clientX),
        y: Math.min(start.y, event.clientY),
        width: Math.abs(event.clientX - start.x),
        height: Math.abs(event.clientY - start.y),
      });
      selection = { kind: "region", pageRect: toPage(box, false), isFixed: false };
    } else {
      const target = hovered ?? elementAt(event.clientX, event.clientY);
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const isFixed = isFixedElement(target);
      const box = clipToViewport({
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      });
      selection = { kind: target.tagName.toLowerCase(), pageRect: toPage(box, isFixed), isFixed };
    }
    if (selection.pageRect.width <= 0 || selection.pageRect.height <= 0) return;
    const chosen = selection;
    clearHover();
    const opened = openForm({
      anchor: toViewport(chosen.pageRect, chosen.isFixed),
      comment: "",
      onSave: (comment) => {
        pendingSave = opened;
        post({
          type: "save",
          url: win.location.href,
          kind: chosen.kind,
          comment,
          rect: toViewport(chosen.pageRect, chosen.isFixed),
          scroll: { x: win.scrollX, y: win.scrollY },
          isFixed: chosen.isFixed,
          viewport: viewport(),
        });
        return "pending";
      },
    });
  }

  function stop(event: Event) {
    event.stopPropagation();
  }

  function openForm(options: {
    anchor: Box;
    comment: string;
    onSave: (comment: string) => "pending" | "done";
    onDelete?: () => void;
  }): Form {
    form?.close();
    const node = root.appendChild(element("div", "form"));
    const textarea = node.appendChild(element("textarea", ""));
    textarea.maxLength = MAX_COMMENT;
    textarea.placeholder = "What should change here?";
    textarea.value = options.comment;
    const error = element("div", "error");
    const row = node.appendChild(element("div", "row"));
    const hint = row.appendChild(element("span", "hint"));
    hint.textContent = "Enter to save";
    if (options.onDelete) {
      const remove = row.appendChild(element("button", "danger"));
      remove.textContent = "Delete";
      const onDelete = options.onDelete;
      remove.addEventListener("click", () => {
        onDelete();
        handle.close();
      });
    }
    const cancel = row.appendChild(element("button", ""));
    cancel.textContent = "Cancel";
    const save = row.appendChild(element("button", "primary"));
    save.textContent = "Save";

    const handle: Form = {
      submit() {
        if (textarea.disabled || textarea.value.trim().length === 0) return;
        error.remove();
        if (options.onSave(textarea.value) === "pending") {
          textarea.disabled = true;
          save.disabled = true;
        } else {
          handle.close();
        }
      },
      dismiss: () => handle.close(),
      showError(message) {
        textarea.disabled = false;
        save.disabled = false;
        error.textContent = message;
        node.appendChild(error);
        textarea.focus();
      },
      close() {
        node.remove();
        if (form === handle) form = null;
        if (pendingSave === handle) pendingSave = null;
      },
    };
    save.addEventListener("click", () => handle.submit());
    cancel.addEventListener("click", () => handle.dismiss());

    const { width, height } = viewport();
    const below = options.anchor.y + options.anchor.height + 8;
    const top = below + 150 <= height ? below : Math.max(8, options.anchor.y - 158);
    node.style.left = `${Math.min(Math.max(8, options.anchor.x), Math.max(8, width - 308))}px`;
    node.style.top = `${Math.min(top, Math.max(8, height - 158))}px`;
    form = handle;
    textarea.focus();
    return handle;
  }

  function renderPins() {
    pinsLayer.replaceChildren();
    for (const pin of pins) {
      const box = toViewport(pin.rect, pin.isFixed);
      const outline = pinsLayer.appendChild(element("div", "pin-box"));
      place(outline, box);
      const badge = pinsLayer.appendChild(element("div", "pin"));
      badge.textContent = String(pin.number);
      badge.title = pin.comment;
      badge.style.left = `${box.x - 11}px`;
      badge.style.top = `${box.y - 11}px`;
      badge.addEventListener("pointerdown", (event) => event.preventDefault());
      badge.addEventListener("click", () => {
        clearHover();
        openForm({
          anchor: toViewport(pin.rect, pin.isFixed),
          comment: pin.comment,
          onSave: (comment) => {
            post({ type: "update", id: pin.id, comment });
            return "done";
          },
          onDelete: () => post({ type: "delete", id: pin.id }),
        });
      });
    }
  }

  function onScroll() {
    if (frame) return;
    frame = win.requestAnimationFrame(() => {
      frame = 0;
      renderPins();
    });
  }

  // Page key handlers would otherwise see typing in the form, retargeted to
  // the host, as page hotkeys. Stopping propagation here also skips listeners
  // inside the shadow root, so the form's own keys are handled here too.
  function onKey(event: KeyboardEvent) {
    if (form && doc.activeElement === host) {
      event.stopImmediatePropagation();
      if (event.type !== "keydown" || event.isComposing) return;
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        form.submit();
      } else if (event.key === "Escape") {
        event.preventDefault();
        form.dismiss();
      }
      return;
    }
    if (event.type !== "keydown" || event.key !== "Escape" || !modeOn || form) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    api.setMode(false);
    post({ type: "mode", on: false });
  }
  const keyEvents = ["keydown", "keyup", "keypress"] as const;

  for (const type of [
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "contextmenu",
    "input",
    "focusin",
    "wheel",
  ]) {
    host.addEventListener(type, stop);
  }
  win.addEventListener("scroll", onScroll, { passive: true, capture: true });
  win.addEventListener("resize", onScroll, { passive: true });
  for (const type of keyEvents) win.addEventListener(type, onKey, true);

  const api: AnnotatorApi = {
    ping() {},
    setTheme(theme) {
      for (const [key, value] of Object.entries(theme)) {
        if (value) host.style.setProperty(`--bba-${key}`, value);
        else host.style.removeProperty(`--bba-${key}`);
      }
    },
    setMode(on) {
      modeOn = on;
      if (on && !layer) {
        layer = root.insertBefore(element("div", "layer"), pinsLayer);
        layer.addEventListener("pointermove", onPointerMove);
        layer.addEventListener("pointerdown", onPointerDown);
        layer.addEventListener("pointerup", onPointerUp);
        layer.addEventListener("pointerleave", () => {
          if (!pointerStart) clearHover();
        });
        layer.addEventListener("click", (event) => event.preventDefault());
        layer.addEventListener("contextmenu", (event) => event.preventDefault());
      } else if (!on && layer) {
        layer.remove();
        layer = null;
        clearHover();
        dragBox?.remove();
        dragBox = null;
        pointerStart = null;
        if (form && form === pendingSave) form.close();
      }
    },
    setPins(next) {
      pins = next;
      renderPins();
    },
    saved() {
      pendingSave?.close();
    },
    saveFailed(message) {
      pendingSave?.showError(message);
      pendingSave = null;
    },
    hide() {
      host.style.visibility = "hidden";
      return new Promise((resolve) =>
        win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())),
      );
    },
    show() {
      host.style.visibility = "visible";
    },
    teardown() {
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("scroll", onScroll, { capture: true });
      win.removeEventListener("resize", onScroll);
      for (const type of keyEvents) win.removeEventListener(type, onKey, true);
      host.remove();
      if (win.__bbBrowserAnnotate === api) delete win.__bbBrowserAnnotate;
    },
  };
  win.__bbBrowserAnnotate = api;
  return api;
}
