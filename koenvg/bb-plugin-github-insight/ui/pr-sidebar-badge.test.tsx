// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ReviewQueueResult, rpcContract } from "../contract";
import {
  ok,
  panelRpc,
  queuePr,
  reviewThread,
  view,
  type QueueHandler,
} from "../test/review-queue-fixtures";

const app = await loadPluginApp(() => import("../app"));
const badge = app.navPanels.find(
  (registration) => registration.id === "pull-requests",
)!.experimental_sidebarAccessory;

afterEach(cleanup);

describe("Pull Requests sidebar badge", () => {
  function renderBadge(getReviewQueue: QueueHandler) {
    return renderSlot<object, typeof rpcContract>(
      { component: badge! },
      {},
      { rpc: panelRpc(getReviewQueue) },
    );
  }

  const returnedThread = { ...reviewThread, status: "idle", returned: "finished" } as const;

  it("shows nothing while loading and when nothing waits", async () => {
    let result: ReviewQueueResult = { kind: "loading" };
    const slot = renderBadge(() => result);
    await vi.waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));
    expect(slot.container.textContent).toBe("");

    result = ok(view([]));
    await slot.behavior.emitRealtime("review-queue.updated", result);
    expect(slot.container.textContent).toBe("");
  });

  it("shows the muted needs-review count", async () => {
    const slot = renderBadge(() =>
      ok(view([queuePr(), queuePr({ number: 16 }), queuePr({ review: "reviewed" })])),
    );

    const count = await slot.findByTestId("review-count");
    expect(count.textContent).toBe("2");
    expect(slot.queryByRole("img", { name: "Review agent came back" })).toBeNull();
  });

  it("marks the count when a PR is unseen", async () => {
    const slot = renderBadge(() => ok({ ...view([queuePr()]), hasUnseen: true }));

    expect((await slot.findByTestId("review-count")).textContent).toBe("1, new");
  });

  it("shows the dot when a review agent came back, also without a count", async () => {
    const slot = renderBadge(() =>
      ok({
        ...view([queuePr({ review: "reviewed", thread: returnedThread })]),
        hasReturned: true,
      }),
    );

    expect(await slot.findByRole("img", { name: "Review agent came back" })).toBeDefined();
    expect(slot.queryByTestId("review-count")).toBeNull();
  });

  it("follows queue updates and keeps the last good state on errors", async () => {
    const slot = renderBadge(() => ok(view([queuePr()])));
    expect((await slot.findByTestId("review-count")).textContent).toBe("1");

    const next = ok({ ...view([queuePr(), queuePr({ number: 16 })]), hasUnseen: true });
    await slot.behavior.emitRealtime("review-queue.updated", next);
    expect(slot.getByTestId("review-count").textContent).toBe("2, new");

    await slot.behavior.emitRealtime("review-queue.updated", {
      kind: "error",
      message: "gh not logged in",
      lastGood: next,
    });
    expect(slot.getByTestId("review-count").textContent).toBe("2, new");
  });
});
