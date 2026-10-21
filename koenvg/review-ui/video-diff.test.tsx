// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { ReviewVideoDiff } from "./video-diff";
import type { ReviewImageDiffProps } from "./image-diff";

const labels = {
  before: { path: "old.mp4", revision: "base" },
  after: { path: "new.mp4", revision: "head" },
};
const ready = { kind: "ready" as const, blob: new Blob(["video"], { type: "video/mp4" }) };
beforeEach(() => {
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:video"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "canPlayType").mockReturnValue("probably");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("video revision previews", () => {
  it("loads only the requested side, with native controls and no autoplay", async () => {
    const load = vi.fn<ReviewImageDiffProps["load"]>().mockResolvedValue(ready);
    const screen = render(<ReviewVideoDiff {...labels} active load={load} />);
    expect(load).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Load before video" }));
    await waitFor(() => expect(screen.getByLabelText("Before: old.mp4 (base)")).toBeTruthy());
    expect(load.mock.calls.map(([side]) => side)).toEqual(["before"]);
    const video = screen.getByLabelText("Before: old.mp4 (base)") as HTMLVideoElement;
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.preload).toBe("none");
    expect(video.playsInline).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Unload before video" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:video");
    expect(screen.queryByLabelText("Before: old.mp4 (base)")).toBeNull();
  });
  it("keeps absent sides and playback failures independent with useful fallback", async () => {
    const load = vi.fn<ReviewImageDiffProps["load"]>().mockResolvedValue(ready);
    const screen = render(<ReviewVideoDiff {...labels} before={null} active load={load} />);
    expect(screen.getByText("Not present")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load before video" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load after video" }));
    await waitFor(() => expect(screen.getByLabelText("After: new.mp4 (head)")).toBeTruthy());
    fireEvent.error(screen.getByLabelText("After: new.mp4 (head)"));
    expect(screen.getByRole("alert").textContent).toContain("codec");
    expect(screen.getByRole("button", { name: "Retry after video" })).toBeTruthy();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
  it("aborts on hiding and ignores delayed completion, requiring another click", async () => {
    let finish!: (value: typeof ready) => void;
    const load = vi.fn<ReviewImageDiffProps["load"]>(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const screen = render(<ReviewVideoDiff {...labels} active load={load} />);
    fireEvent.click(screen.getByRole("button", { name: "Load before video" }));
    screen.rerender(<ReviewVideoDiff {...labels} active={false} load={load} />);
    expect(load.mock.calls[0]![1].aborted).toBe(true);
    await act(async () => finish(ready));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    screen.rerender(<ReviewVideoDiff {...labels} active load={load} />);
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Load before video" })).toBeTruthy();
  });
  it("reports unsupported playback without allocating a URL", async () => {
    vi.mocked(HTMLMediaElement.prototype.canPlayType).mockReturnValue("");
    const screen = render(<ReviewVideoDiff {...labels} active load={async () => ready} />);
    fireEvent.click(screen.getByRole("button", { name: "Load before video" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("local player");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
