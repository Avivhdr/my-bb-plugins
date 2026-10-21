// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OUTLINE_WIDTH_KEY, useOutlineWidth } from "./use-outline-width";

afterEach(() => localStorage.clear());

describe("useOutlineWidth", () => {
  it.each([
    [null, 320],
    ["400", 400],
    ["900", 520],
    ["100", 240],
    ["wide", 320],
  ])("loads %s as %i", (stored, width) => {
    if (stored !== null) localStorage.setItem(OUTLINE_WIDTH_KEY, stored);

    expect(renderHook(() => useOutlineWidth()).result.current.width).toBe(width);
  });

  it("previews a clamped width without saving it", () => {
    const { result } = renderHook(() => useOutlineWidth());

    act(() => result.current.preview(700));

    expect(result.current.width).toBe(520);
    expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBeNull();
  });

  it("commits a clamped width and saves it", () => {
    const { result } = renderHook(() => useOutlineWidth());

    act(() => result.current.commit(100));

    expect(result.current.width).toBe(240);
    expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBe("240");
  });

  it("resets to the default and forgets the saved width", () => {
    localStorage.setItem(OUTLINE_WIDTH_KEY, "400");
    const { result } = renderHook(() => useOutlineWidth());

    act(() => result.current.reset());

    expect(result.current.width).toBe(320);
    expect(localStorage.getItem(OUTLINE_WIDTH_KEY)).toBeNull();
  });
});
