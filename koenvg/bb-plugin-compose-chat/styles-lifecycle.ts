const marker = "data-compose-chat";
const active = "active";

/** Own activation and visibility markers. BB owns stylesheets and chat DOM. */
export function mountStyles({ signal }: { signal: AbortSignal }): () => void {
  if (signal.aborted) return () => {};
  const root = document.documentElement;
  const previous = root.getAttribute(marker);
  root.setAttribute(marker, active);
  const motionMarker = "data-compose-chat-motion";
  const previousMotion = root.getAttribute(motionMarker);
  let motionState: string;
  const syncVisibility = () => {
    motionState = document.visibilityState === "hidden" ? "paused" : "running";
    root.setAttribute(motionMarker, motionState);
  };
  syncVisibility();
  document.addEventListener("visibilitychange", syncVisibility);
  let disposed = false;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener("abort", dispose);
    document.removeEventListener("visibilitychange", syncVisibility);
    if (root.getAttribute(motionMarker) === motionState) {
      if (previousMotion === null) root.removeAttribute(motionMarker);
      else root.setAttribute(motionMarker, previousMotion);
    }
    if (root.getAttribute(marker) !== active) return;
    if (previous === null) root.removeAttribute(marker);
    else root.setAttribute(marker, previous);
  };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}
