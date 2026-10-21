// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEEN_AFTER_MS, useCommentSeen } from "./use-comment-seen";

let report: (entry: Partial<IntersectionObserverEntry>) => void = () => {};

class ManualObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {
    report = (entry) =>
      act(() =>
        this.callback(
          [entry as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
      );
  }
  observe() {}
  disconnect() {}
}

const ROOT = { height: 400 } as DOMRectReadOnly;
const inView = { isIntersecting: true, intersectionRatio: 1, rootBounds: ROOT };
const outOfView = { isIntersecting: false, intersectionRatio: 0, rootBounds: ROOT };

function Comment({ onSeen }: { onSeen: () => void }) {
  const element = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useCommentSeen(element, root, true, onSeen);
  return (
    <div ref={root}>
      <div ref={element}>New reply</div>
    </div>
  );
}

function renderComment() {
  const onSeen = vi.fn();
  render(<Comment onSeen={onSeen} />);
  return onSeen;
}

function wait(ms: number) {
  act(() => vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", ManualObserver);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCommentSeen", () => {
  it("reports the comment seen after it shows for the dwell time", () => {
    const onSeen = renderComment();

    report(inView);
    wait(SEEN_AFTER_MS);

    expect(onSeen).toHaveBeenCalledOnce();
  });

  it("does not report a comment that the user scrolls past", () => {
    const onSeen = renderComment();

    report(inView);
    wait(500);
    report(outOfView);
    wait(SEEN_AFTER_MS);

    expect(onSeen).not.toHaveBeenCalled();
  });

  it("does not report a comment that is less than 60% visible", () => {
    const onSeen = renderComment();

    report({
      isIntersecting: true,
      intersectionRatio: 0.5,
      intersectionRect: { height: 50 } as DOMRectReadOnly,
      rootBounds: ROOT,
    });
    wait(SEEN_AFTER_MS);

    expect(onSeen).not.toHaveBeenCalled();
  });

  it("waits for the window to have focus", () => {
    vi.mocked(document.hasFocus).mockReturnValue(false);
    const onSeen = renderComment();

    report(inView);
    wait(SEEN_AFTER_MS);
    expect(onSeen).not.toHaveBeenCalled();

    vi.mocked(document.hasFocus).mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("focus")));
    wait(SEEN_AFTER_MS);

    expect(onSeen).toHaveBeenCalledOnce();
  });

  it("stops the dwell time when the window loses focus", () => {
    const onSeen = renderComment();

    report(inView);
    wait(1000);
    vi.mocked(document.hasFocus).mockReturnValue(false);
    act(() => window.dispatchEvent(new Event("blur")));
    wait(SEEN_AFTER_MS);

    expect(onSeen).not.toHaveBeenCalled();
  });

  it("reports a comment taller than the diff area that fills the diff area", () => {
    const onSeen = renderComment();

    report({
      isIntersecting: true,
      intersectionRatio: 0.4,
      intersectionRect: { height: 400 } as DOMRectReadOnly,
      rootBounds: ROOT,
    });
    wait(SEEN_AFTER_MS);

    expect(onSeen).toHaveBeenCalledOnce();
  });

  it("stops the dwell time when the page is hidden", () => {
    const onSeen = renderComment();

    report(inView);
    wait(1000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    wait(SEEN_AFTER_MS);

    expect(onSeen).not.toHaveBeenCalled();
  });
});
