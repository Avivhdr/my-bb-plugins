import { useEffect, type RefObject } from "react";

export const SEEN_AFTER_MS = 1500;
const VISIBLE_SHARE = 0.6;
const THRESHOLDS = Array.from({ length: 11 }, (_, step) => step / 10);

function isVisibleEnough(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= VISIBLE_SHARE) return true;
  const rootHeight = entry.rootBounds?.height ?? 0;
  return rootHeight > 0 && entry.intersectionRect.height >= VISIBLE_SHARE * rootHeight;
}

function isAttended(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

export function useCommentSeen(
  element: RefObject<HTMLElement | null>,
  root: RefObject<HTMLElement | null>,
  active: boolean,
  onSeen: () => void,
): void {
  useEffect(() => {
    const target = element.current;
    if (!active || target === null) return;
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const ready = visible && isAttended();
      if (ready && timer === undefined) timer = setTimeout(onSeen, SEEN_AFTER_MS);
      if (!ready && timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries.at(-1);
        if (entry === undefined) return;
        visible = isVisibleEnough(entry);
        update();
      },
      { root: root.current, threshold: THRESHOLDS },
    );
    observer.observe(target);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
    };
  }, [element, root, active, onSeen]);
}
