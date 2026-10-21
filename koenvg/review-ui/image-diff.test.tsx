// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ReviewImageDiff, type ImageResult, type ReviewImageDiffProps } from "./image-diff";

let visible: ((near: boolean) => void)[];
const create = vi.fn(() => "blob:preview");
const revoke = vi.fn();
beforeEach(() => {
  visible = [];
  create.mockClear();
  revoke.mockClear();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        visible.push((near) =>
          callback(
            [{ isIntersecting: near }] as IntersectionObserverEntry[],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const ready: ImageResult = { kind: "ready", blob: new Blob(["raster"], { type: "image/png" }) };
const labels = {
  before: { path: "old.png", revision: "base-sha" },
  after: { path: "new.png", revision: "head-sha" },
};
function near(value: boolean) {
  act(() => {
    for (const callback of visible) callback(value);
  });
}
describe("inline image comparison", () => {
  it("waits for visibility, releases offscreen and on collapse, and never fetches absence", async () => {
    const load = vi.fn<ReviewImageDiffProps["load"]>(async () => ready);
    const props: ReviewImageDiffProps = { ...labels, before: null, active: true, load };
    const screen = render(<ReviewImageDiff {...props} />);
    expect(load).not.toHaveBeenCalled();
    expect(screen.getByText("Not present")).toBeTruthy();
    near(true);
    await screen.findByRole("img", { name: "After: new.png (head-sha)" });
    expect(load.mock.calls.map((call) => call[0])).toEqual(["after"]);
    near(false);
    expect(screen.queryByRole("img")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:preview");
    near(true);
    await screen.findByRole("img");
    screen.rerender(<ReviewImageDiff {...props} active={false} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it("retains a successful side, retries only a failure and handles browser decode failure", async () => {
    const load = vi.fn<ReviewImageDiffProps["load"]>(async (side) =>
      side === "before" ? { kind: "error", code: "read", message: "Read failed" } : ready,
    );
    const screen = render(<ReviewImageDiff {...labels} active load={load} />);
    near(true);
    await screen.findByText("Read failed");
    expect(screen.getByRole("img", { name: "After: new.png (head-sha)" })).toBeTruthy();
    load.mockImplementation(async () => ready);
    fireEvent.click(screen.getByRole("button", { name: "Retry before" }));
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(load.mock.calls.map(([side]) => side)).toEqual(["before", "after", "before"]);
    fireEvent.error(screen.getByRole("img", { name: "Before: old.png (base-sha)" }));
    expect(screen.getByText("Browser could not decode this image")).toBeTruthy();
    expect(screen.getByRole("img", { name: "After: new.png (head-sha)" })).toBeTruthy();
    expect(revoke).toHaveBeenCalledTimes(1);
    screen.unmount();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it("ignores delayed results after invalidation and aborts each loader signal", async () => {
    const pending: ((result: ImageResult) => void)[] = [];
    const load = vi.fn<ReviewImageDiffProps["load"]>(
      () => new Promise((resolve) => pending.push(resolve)),
    );
    const screen = render(<ReviewImageDiff {...labels} active load={load} />);
    near(true);
    expect(pending).toHaveLength(2);
    screen.rerender(<ReviewImageDiff {...labels} active={false} load={load} />);
    expect(load.mock.calls.every(([, signal]) => signal.aborted)).toBe(true);
    await act(async () => {
      for (const resolve of pending) resolve(ready);
    });
    expect(create).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
