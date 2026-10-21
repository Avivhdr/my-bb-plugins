// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinToTop } from "./pin-to-top";

const AREA_TOP = 100;
const ignoreStop = () => {};

let resizeCallbacks: ResizeObserverCallback[] = [];

class FakeResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }
  observe() {}
  disconnect() {
    resizeCallbacks = [];
  }
}

function resize() {
  for (const callback of resizeCallbacks) callback([], {} as ResizeObserver);
}

function placeAt(element: HTMLElement, contentTop: () => number, area: HTMLElement) {
  element.getBoundingClientRect = () =>
    ({ top: AREA_TOP + contentTop() - area.scrollTop, bottom: 0 }) as DOMRect;
}

function setUp() {
  const area = document.createElement("div");
  const content = document.createElement("div");
  const first = document.createElement("section");
  const second = document.createElement("section");
  content.append(first, second);
  area.append(content);
  document.body.append(area);
  area.getBoundingClientRect = () => ({ top: AREA_TOP }) as DOMRect;
  let secondTop = 500;
  placeAt(first, () => 0, area);
  placeAt(second, () => secondTop, area);
  return {
    area,
    content,
    first,
    second,
    moveSecond(top: number) {
      secondTop = top;
    },
  };
}

beforeEach(() => {
  resizeCallbacks = [];
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("pinToTop", () => {
  it("scrolls the target to the top of the area at once", () => {
    const { area, content, second } = setUp();
    pinToTop(area, content, () => ({ element: second, inset: 0 }), ignoreStop);
    expect(area.scrollTop).toBe(500);
  });

  it("keeps the target at the top when content above it changes height", () => {
    const { area, content, second, moveSecond } = setUp();
    pinToTop(area, content, () => ({ element: second, inset: 0 }), ignoreStop);
    moveSecond(900);
    resize();
    expect(area.scrollTop).toBe(900);
  });

  it("follows a target that the resolver changes after a resize", () => {
    const { area, content, first, second } = setUp();
    let target = first;
    pinToTop(area, content, () => ({ element: target, inset: 0 }), ignoreStop);
    target = second;
    resize();
    expect(area.scrollTop).toBe(500);
  });

  it("keeps the target an inset below the top", () => {
    const { area, content, second } = setUp();
    pinToTop(area, content, () => ({ element: second, inset: 48 }), ignoreStop);
    expect(area.scrollTop).toBe(452);
  });

  it.each([
    ["wheel", (area: HTMLElement) => area.dispatchEvent(new Event("wheel"))],
    ["pointerdown", (area: HTMLElement) => area.dispatchEvent(new Event("pointerdown"))],
    ["keydown", () => document.dispatchEvent(new KeyboardEvent("keydown"))],
  ])("stops on %s", (_name, fire) => {
    const { area, content, second, moveSecond } = setUp();
    const onStop = vi.fn();
    pinToTop(area, content, () => ({ element: second, inset: 0 }), onStop);
    fire(area);
    moveSecond(900);
    resize();
    expect(area.scrollTop).toBe(500);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("stops when no resize comes for a second", () => {
    const { area, content, second } = setUp();
    const onStop = vi.fn();
    pinToTop(area, content, () => ({ element: second, inset: 0 }), onStop);
    vi.advanceTimersByTime(900);
    resize();
    vi.advanceTimersByTime(900);
    expect(onStop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("stops when the target leaves the DOM", () => {
    const { area, content, second } = setUp();
    const onStop = vi.fn();
    pinToTop(area, content, () => ({ element: second, inset: 0 }), onStop);
    second.remove();
    resize();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("calls onStop once when stopped by the caller", () => {
    const { area, content, second } = setUp();
    const onStop = vi.fn();
    const stop = pinToTop(area, content, () => ({ element: second, inset: 0 }), onStop);
    stop();
    stop();
    vi.advanceTimersByTime(2000);
    expect(onStop).toHaveBeenCalledOnce();
  });
});
