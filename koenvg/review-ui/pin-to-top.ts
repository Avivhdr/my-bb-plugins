const PIN_SETTLE_MS = 1000;
const POINTER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown"] as const;

export interface PinTarget {
  element: HTMLElement;
  inset: number;
}

export function pinToTop(
  area: HTMLElement,
  content: HTMLElement | null,
  target: () => PinTarget | null,
  onStop: () => void,
): () => void {
  let stopped = false;
  let timer = setTimeout(stop, PIN_SETTLE_MS);
  const observer = new ResizeObserver(() => {
    align();
    clearTimeout(timer);
    timer = setTimeout(stop, PIN_SETTLE_MS);
  });
  if (content !== null) observer.observe(content);
  for (const event of POINTER_SCROLL_EVENTS) area.addEventListener(event, stop, { passive: true });
  document.addEventListener("keydown", stop);
  align();
  return stop;

  function align() {
    if (stopped) return;
    const pinned = target();
    if (pinned === null || !pinned.element.isConnected) return stop();
    area.scrollTop += offsetFromTop(area, pinned);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    observer.disconnect();
    for (const event of POINTER_SCROLL_EVENTS) area.removeEventListener(event, stop);
    document.removeEventListener("keydown", stop);
    onStop();
  }
}

export function offsetFromTop(area: HTMLElement, { element, inset }: PinTarget): number {
  return element.getBoundingClientRect().top - area.getBoundingClientRect().top - inset;
}
