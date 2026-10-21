// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cancelPrPanelRequest, receivePrPanel, requestPrPanel } from "./pr-panel-navigation";

const disposals: (() => void)[] = [];
afterEach(() => {
  disposals.splice(0).forEach((dispose) => dispose());
  cancelPrPanelRequest();
  vi.useRealTimers();
});

it("opens the requested thread when its receiver mounts after navigation", () => {
  const navigate = vi.fn();
  requestPrPanel("thread-b", navigate);
  expect(navigate).toHaveBeenCalledOnce();
  const wrongThread = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-a", wrongThread));
  expect(wrongThread).not.toHaveBeenCalled();
  const open = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).toHaveBeenCalledOnce();
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).toHaveBeenCalledOnce();
});

it("expires abandoned requests instead of opening a panel on a later visit", () => {
  vi.useFakeTimers();
  requestPrPanel("thread-b", () => {});
  vi.advanceTimersByTime(30_000);
  const open = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).not.toHaveBeenCalled();
});

it("notifies a mounted receiver and stops notifying it after disposal", () => {
  const open = vi.fn(() => true);
  const dispose = receivePrPanel("thread-b", open);
  requestPrPanel("thread-b", () => {});
  expect(open).toHaveBeenCalledOnce();
  dispose();
  requestPrPanel("thread-b", () => {});
  expect(open).toHaveBeenCalledOnce();
});

it("keeps requests in their originating client window", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  disposals.push(() => frame.remove());
  const otherClient = frame.contentWindow!;
  requestPrPanel("thread-b", () => {});
  const otherOpen = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", otherOpen, otherClient));
  expect(otherOpen).not.toHaveBeenCalled();
  requestPrPanel("thread-b", () => {}, otherClient);
  expect(otherOpen).toHaveBeenCalledOnce();
  const ownOpen = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", ownOpen));
  expect(ownOpen).toHaveBeenCalledOnce();
});

it("shares pending intent across separately evaluated plugin bundles", async () => {
  vi.resetModules();
  const otherBundle = await import("./pr-panel-navigation");
  requestPrPanel("thread-b", () => {});
  const open = vi.fn(() => true);
  disposals.push(otherBundle.receivePrPanel("thread-b", open));
  expect(open).toHaveBeenCalledOnce();
});

it("allows only the latest requested thread to open", () => {
  requestPrPanel("thread-b", () => {});
  requestPrPanel("thread-c", () => {});
  const oldOpen = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", oldOpen));
  expect(oldOpen).not.toHaveBeenCalled();
  const latestOpen = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-c", latestOpen));
  expect(latestOpen).toHaveBeenCalledOnce();
});

it("does not let a stale acknowledgement clear a newer request", () => {
  disposals.push(
    receivePrPanel("thread-a", () => {
      requestPrPanel("thread-b", () => {});
      return true;
    }),
  );
  requestPrPanel("thread-a", () => {});
  const open = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).toHaveBeenCalledOnce();
});

it("cancels intent when the user chooses ordinary navigation", () => {
  requestPrPanel("thread-b", () => {});
  cancelPrPanelRequest();
  const open = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).not.toHaveBeenCalled();
});

it("retains a declined request for a receiver with a side panel", () => {
  disposals.push(receivePrPanel("thread-b", () => false));
  requestPrPanel("thread-b", () => {});
  const open = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).toHaveBeenCalledOnce();
});

it("does not open twice when registration reenters the receiver", () => {
  const duplicate = vi.fn(() => true);
  disposals.push(
    receivePrPanel("thread-b", () => {
      disposals.push(receivePrPanel("thread-b", duplicate));
      return true;
    }),
  );
  requestPrPanel("thread-b", () => {});
  expect(duplicate).not.toHaveBeenCalled();
});

it("contains an opening failure and lets a later receiver handle the request", () => {
  requestPrPanel("thread-b", () => {});
  expect(() => {
    disposals.push(
      receivePrPanel("thread-b", () => {
        throw new Error("panel unavailable");
      }),
    );
  }).not.toThrow();
  const open = vi.fn(() => true);
  disposals.push(receivePrPanel("thread-b", open));
  expect(open).toHaveBeenCalledOnce();
});
