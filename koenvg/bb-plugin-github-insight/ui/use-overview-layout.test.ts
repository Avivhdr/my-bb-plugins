// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OVERVIEW_LAYOUT_KEY, useOverviewLayout } from "./use-overview-layout";

afterEach(() => localStorage.clear());

function stored() {
  return JSON.parse(localStorage.getItem(OVERVIEW_LAYOUT_KEY) ?? "null");
}

describe("useOverviewLayout", () => {
  it.each([
    [null, { width: 440, maximized: false }],
    [
      { width: 600, maximized: true },
      { width: 600, maximized: true },
    ],
    [{ width: 5000 }, { width: 960, maximized: false }],
    [
      { width: 100, maximized: false },
      { width: 360, maximized: false },
    ],
    [
      { width: "wide", maximized: "yes" },
      { width: 440, maximized: false },
    ],
    ["not json", { width: 440, maximized: false }],
  ])("loads %j as %j", (saved, layout) => {
    if (saved !== null)
      localStorage.setItem(
        OVERVIEW_LAYOUT_KEY,
        typeof saved === "string" ? saved : JSON.stringify(saved),
      );

    expect(renderHook(() => useOverviewLayout()).result.current.layout).toEqual(layout);
  });

  it("previews a clamped width without saving it", () => {
    const { result } = renderHook(() => useOverviewLayout());

    act(() => result.current.previewWidth(2000));

    expect(result.current.layout.width).toBe(960);
    expect(stored()).toBeNull();
  });

  it("commits a clamped width and saves it with the maximized flag", () => {
    const { result } = renderHook(() => useOverviewLayout());

    act(() => result.current.commitWidth(100));

    expect(result.current.layout.width).toBe(360);
    expect(stored()).toEqual({ width: 360, maximized: false });
  });

  it("toggles maximized and keeps the width", () => {
    localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify({ width: 500, maximized: false }));
    const { result } = renderHook(() => useOverviewLayout());

    act(() => result.current.toggleMaximized());
    expect(stored()).toEqual({ width: 500, maximized: true });

    act(() => result.current.toggleMaximized());
    expect(stored()).toEqual({ width: 500, maximized: false });
  });

  it("resets the width to the default", () => {
    localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify({ width: 700, maximized: true }));
    const { result } = renderHook(() => useOverviewLayout());

    act(() => result.current.resetWidth());

    expect(stored()).toEqual({ width: 440, maximized: true });
  });
});
