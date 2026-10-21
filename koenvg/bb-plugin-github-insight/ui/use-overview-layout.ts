import { useState } from "react";

export interface OverviewLayout {
  width: number;
  maximized: boolean;
}

export const OVERVIEW_LAYOUT_KEY = "bb-github-insight:overview-layout";
export const OVERVIEW_WIDTH = { min: 360, max: 960, default: 440 } as const;

const DEFAULT_LAYOUT: OverviewLayout = { width: OVERVIEW_WIDTH.default, maximized: false };

export function useOverviewLayout() {
  const [layout, setLayout] = useState(readLayout);

  function save(next: OverviewLayout) {
    setLayout(next);
    try {
      localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify(next));
    } catch {}
  }

  function previewWidth(width: number) {
    setLayout((current) => ({ ...current, width: clampWidth(width) }));
  }

  function commitWidth(width: number) {
    save({ ...layout, width: clampWidth(width) });
  }

  function resetWidth() {
    save({ ...layout, width: OVERVIEW_WIDTH.default });
  }

  function toggleMaximized() {
    save({ ...layout, maximized: !layout.maximized });
  }

  return { layout, previewWidth, commitWidth, resetWidth, toggleMaximized };
}

function readLayout(): OverviewLayout {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OVERVIEW_LAYOUT_KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return DEFAULT_LAYOUT;
    const { width, maximized } = stored as Partial<Record<keyof OverviewLayout, unknown>>;
    return {
      width:
        typeof width === "number" && Number.isFinite(width)
          ? clampWidth(width)
          : OVERVIEW_WIDTH.default,
      maximized: maximized === true,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function clampWidth(width: number): number {
  return Math.round(Math.min(OVERVIEW_WIDTH.max, Math.max(OVERVIEW_WIDTH.min, width)));
}
