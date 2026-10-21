import { useState } from "react";

export const OUTLINE_WIDTH_KEY = "bb-changes:outline-width";
export const OUTLINE_WIDTH = { min: 240, max: 520, default: 320 } as const;

export function useOutlineWidth() {
  const [width, setWidth] = useState(readWidth);

  function preview(next: number) {
    setWidth(clamp(next));
  }

  function commit(next: number) {
    const clamped = clamp(next);
    setWidth(clamped);
    try {
      localStorage.setItem(OUTLINE_WIDTH_KEY, String(clamped));
    } catch {}
  }

  function reset() {
    setWidth(OUTLINE_WIDTH.default);
    try {
      localStorage.removeItem(OUTLINE_WIDTH_KEY);
    } catch {}
  }

  return { width, preview, commit, reset };
}

function readWidth(): number {
  try {
    const stored = localStorage.getItem(OUTLINE_WIDTH_KEY)?.trim();
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? clamp(parsed) : OUTLINE_WIDTH.default;
  } catch {
    return OUTLINE_WIDTH.default;
  }
}

function clamp(width: number): number {
  return Math.round(Math.min(OUTLINE_WIDTH.max, Math.max(OUTLINE_WIDTH.min, width)));
}
