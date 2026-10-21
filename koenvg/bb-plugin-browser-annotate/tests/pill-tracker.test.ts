import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPillTracker } from "../lib/pill-tracker";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup() {
  const remove = vi.fn(async () => ({}));
  const clearResolved = vi.fn(async (): Promise<{ removed: string[] }> => ({
    removed: ["a", "b"],
  }));
  const hidden = new Set<string>();
  const tracker = createPillTracker({
    remove,
    clearResolved,
    hide: (id) => hidden.add(id),
    show: (id) => hidden.delete(id),
    delayMs: 1000,
  });
  return { tracker, remove, clearResolved, hidden };
}

describe("pill tracker", () => {
  it("removes an annotation whose pill was seen and then deleted", () => {
    const { tracker, remove } = setup();
    tracker.observe("thr", ["a", "b"]);

    tracker.observe("thr", ["b"]);
    vi.advanceTimersByTime(1000);

    expect(remove).toHaveBeenCalledExactlyOnceWith("thr", "a");
  });

  it("hides the pin at once when its pill is deleted", () => {
    const { tracker, remove, hidden } = setup();
    tracker.observe("thr", ["a", "b"]);

    tracker.observe("thr", ["b"]);

    expect([...hidden]).toEqual(["a"]);
    expect(remove).not.toHaveBeenCalled();
  });

  it("shows the pin again when its pill comes back", () => {
    const { tracker, hidden } = setup();
    tracker.observe("thr", ["a"]);
    tracker.observe("thr", []);

    tracker.observe("thr", ["a"]);

    expect(hidden.size).toBe(0);
  });

  it("does not remove an annotation whose pill was never seen", () => {
    const { tracker, remove } = setup();
    tracker.observe("thr", ["a"]);

    tracker.observe("thr", ["a"]);
    vi.advanceTimersByTime(5000);

    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps an annotation whose pill comes back, as after a failed send", () => {
    const { tracker, remove } = setup();
    tracker.observe("thr", ["a"]);

    tracker.observe("thr", []);
    vi.advanceTimersByTime(500);
    tracker.observe("thr", ["a"]);
    vi.advanceTimersByTime(5000);

    expect(remove).not.toHaveBeenCalled();
  });

  it("clears sent annotations once after a submit, without a second delete", () => {
    const { tracker, remove, clearResolved } = setup();
    tracker.observe("thr", ["a", "b"]);

    tracker.observe("thr", []);
    tracker.submitted("thr");
    vi.advanceTimersByTime(5000);

    expect(clearResolved).toHaveBeenCalledExactlyOnceWith("thr");
    expect(remove).not.toHaveBeenCalled();
  });

  it("keeps sent pins hidden and shows pins that the send did not clear", async () => {
    const { tracker, clearResolved, hidden } = setup();
    clearResolved.mockResolvedValueOnce({ removed: ["a"] });
    tracker.observe("thr", ["a", "b"]);
    tracker.observe("thr", []);

    tracker.submitted("thr");
    await vi.runAllTimersAsync();

    expect([...hidden]).toEqual(["a"]);
  });

  it("keeps a removed pin hidden, and shows it again if the remove fails", async () => {
    const { tracker, remove, hidden } = setup();
    tracker.observe("thr", ["a", "b"]);
    remove.mockRejectedValueOnce(new Error("offline"));

    tracker.observe("thr", ["b"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(hidden.has("a")).toBe(false);

    tracker.observe("thr", []);
    await vi.advanceTimersByTimeAsync(1000);
    expect(hidden.has("b")).toBe(true);
  });

  it("tracks threads separately", () => {
    const { tracker, remove } = setup();
    tracker.observe("one", ["a"]);
    tracker.observe("two", ["b"]);

    tracker.observe("one", []);
    tracker.submitted("two");
    vi.advanceTimersByTime(1000);

    expect(remove).toHaveBeenCalledExactlyOnceWith("one", "a");
  });
});
