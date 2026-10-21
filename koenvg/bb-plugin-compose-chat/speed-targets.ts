export type SpeedTarget = {
  id: number;
  frame: HTMLElement;
  mode: "Fast" | "Ultrafast";
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  cornerAngle: number;
  theme: "light" | "dark";
  visible: boolean;
  clip: string;
};

const margin = 64;
export const speedLayerMargin = margin;
const owned = "[data-compose-speed-owned]";
const surfaceColors = new Map<string, boolean>();

function lightSurface(element: HTMLElement): boolean {
  const color = getComputedStyle(element).backgroundColor;
  const explicit = document.documentElement.dataset.theme;
  if (explicit === "light" || explicit === "dark") return explicit === "light";
  const rgb = color.match(/^rgba?\(\s*([\d.]+)[, ]+([\d.]+)[, ]+([\d.]+)/);
  if (rgb) return Number(rgb[1]) * 0.2126 + Number(rgb[2]) * 0.7152 + Number(rgb[3]) * 0.0722 > 160;
  // Chromium computes modern theme colors as oklab/color(). Resolve through CSS,
  // not a theme-name assumption. No host pixels, text or images are read.
  if (surfaceColors.has(color)) return surfaceColors.get(color)!;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const light = r * 0.2126 + g * 0.7152 + b * 0.0722 > 160;
  if (surfaceColors.size >= 16) surfaceColors.clear();
  surfaceColors.set(color, light);
  return light;
}

/** Read-only native DOM boundary. No polling, native node moves or style writes. */
export function observeSpeedTargets(publish: (targets: SpeedTarget[]) => void): () => void {
  let disposed = false;
  let scheduled = 0;
  let signature = "";
  let nextId = 0;
  const ids = new WeakMap<HTMLElement, number>();
  const observed = new Set<Element>();
  const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
  const observer = new MutationObserver((records) => {
    if (records.some((r) => !(r.target instanceof Element && r.target.closest(owned)))) schedule();
  });

  function schedule() {
    if (!disposed && !scheduled) scheduled = requestAnimationFrame(reconcile);
  }

  function reconcile() {
    scheduled = 0;
    if (disposed) return;
    const targets: SpeedTarget[] = [];
    const nodes = new Set<Element>();
    const active = document.documentElement.getAttribute("data-compose-chat") === "active";
    const modal = [
      ...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
    ].some(
      (el) => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== "hidden",
    );
    if (active)
      for (const composer of document.querySelectorAll<HTMLElement>("[data-app-composer]")) {
        const picker = composer.querySelector(
          'button[aria-label^="Provider, model and reasoning"]',
        );
        const titles = [...(picker?.querySelectorAll("[title]") ?? [])].map(
          (el) => el.getAttribute("title") ?? "",
        );
        const mode = titles.some((t) => /\(Ultrafast mode\)$/i.test(t))
          ? "Ultrafast"
          : titles.some((t) => /\(Fast mode\)$/i.test(t))
            ? "Fast"
            : undefined;
        if (!mode) continue;
        const form = composer.querySelector<HTMLElement>("form[data-promptbox]");
        if (!form) continue;
        const wrapper = form.closest<HTMLElement>("[data-follow-up-composer]");
        const frame = wrapper && !form.hasAttribute("data-promptbox-compact") ? wrapper : form;
        const style = getComputedStyle(frame);
        const rect = frame.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden") continue;
        nodes.add(frame);
        let bottom = rect.bottom;
        // BB's new-thread footer is a sibling; its seam is internal to one frame.
        const footer =
          !wrapper &&
          form.nextElementSibling instanceof HTMLElement &&
          form.nextElementSibling.querySelector("[data-promptbox-project-control]")
            ? form.nextElementSibling
            : null;
        if (footer) {
          const footerRect = footer.getBoundingClientRect();
          if (
            Math.abs(footerRect.left - rect.left) < 2 &&
            Math.abs(footerRect.width - rect.width) < 2
          ) {
            bottom = Math.max(bottom, footerRect.bottom);
            nodes.add(footer);
          }
        }
        const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
        let opaque = style.opacity !== "0";
        for (let parent = frame.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent);
          if (css.opacity === "0") opaque = false;
          const bounds = parent.getBoundingClientRect();
          if (/auto|scroll|hidden|clip/.test(css.overflowX)) {
            clip.left = Math.max(clip.left, bounds.left + parent.clientLeft);
            clip.right = Math.min(clip.right, bounds.left + parent.clientLeft + parent.clientWidth);
          }
          if (/auto|scroll|hidden|clip/.test(css.overflowY)) {
            clip.top = Math.max(clip.top, bounds.top + parent.clientTop);
            clip.bottom = Math.min(
              clip.bottom,
              bounds.top + parent.clientTop + parent.clientHeight,
            );
          }
        }
        const height = bottom - rect.top;
        if (!ids.has(frame)) ids.set(frame, ++nextId);
        const visible =
          opaque &&
          !modal &&
          document.visibilityState !== "hidden" &&
          rect.right > clip.left &&
          rect.left < clip.right &&
          bottom > clip.top &&
          rect.top < clip.bottom;
        const inset = [
          clip.top - rect.top + margin,
          rect.right + margin - clip.right,
          bottom + margin - clip.bottom,
          clip.left - rect.left + margin,
        ].map((n) => Math.max(0, n));
        targets.push({
          id: ids.get(frame)!,
          frame,
          mode,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height,
          radius: parseFloat(style.borderTopLeftRadius) || 14,
          cornerAngle: (Math.atan2(rect.width, height) * 180) / Math.PI,
          theme: lightSurface(frame) ? "light" : "dark",
          visible,
          clip: `inset(${inset.join("px ")}px)`,
        });
      }
    for (const node of observed)
      if (!nodes.has(node)) {
        resize?.unobserve(node);
        observed.delete(node);
      }
    for (const node of nodes)
      if (!observed.has(node)) {
        resize?.observe(node);
        observed.add(node);
      }
    const next = JSON.stringify(targets.map(({ frame: _frame, ...target }) => target));
    if (signature !== next) {
      signature = next;
      publish(targets);
    }
  }

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [
      "title",
      "class",
      "style",
      "hidden",
      "aria-hidden",
      "aria-modal",
      "data-state",
      "data-theme",
      "data-compose-chat",
    ],
  });
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("transitionend", schedule, true);
  document.addEventListener("animationend", schedule, true);
  reconcile();
  return () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(scheduled);
    observer.disconnect();
    resize?.disconnect();
    observed.clear();
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    document.removeEventListener("visibilitychange", schedule);
    document.removeEventListener("transitionend", schedule, true);
    document.removeEventListener("animationend", schedule, true);
  };
}
