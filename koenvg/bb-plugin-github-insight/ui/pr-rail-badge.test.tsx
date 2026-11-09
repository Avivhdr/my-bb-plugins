// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../contract";
import { localDay } from "../core/working-day";
import {
  activityItem,
  activityOk,
  activityPr,
  ok,
  panelRpc,
  queuePr,
  reviewThread,
  view,
  type QueueHandler,
} from "../test/review-queue-fixtures";

const app = await loadPluginApp(() => import("../app"));
const overlay = app.appOverlays.find((registration) => registration.id === "pr-rail-badge")!;

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function addRailItem(key = "github-insight/pull-requests") {
  const item = document.createElement("span");
  item.dataset.navRailItem = key;
  document.body.append(item);
  return item;
}

function renderOverlay(getReviewQueue: QueueHandler) {
  return renderSlot<object, typeof rpcContract>(
    { component: overlay.component },
    {},
    { rpc: panelRpc(getReviewQueue) },
  );
}

describe("Pull Requests rail badge", () => {
  it("shows the needs-review count on the Pull Requests rail item", async () => {
    const item = addRailItem();
    const other = addRailItem("other-plugin/panel");
    renderOverlay(() => ok(view([queuePr(), queuePr({ number: 16 })])));

    const count = await within(item).findByTestId("rail-review-count");
    expect(count.textContent).toBe("2 pull requests need review");
    expect(other.textContent).toBe("");
  });

  it("marks the count when a PR is unseen", async () => {
    const item = addRailItem();
    renderOverlay(() => ok({ ...view([queuePr()]), hasUnseen: true }));

    const count = await within(item).findByTestId("rail-review-count");
    expect(count.textContent).toBe("1 pull request needs review, new");
    expect(count.className).toContain("bg-red-600");
  });

  it("shows the dot when a review agent came back", async () => {
    const item = addRailItem();
    renderOverlay(() => ok({ ...view([]), hasReturned: true }));

    expect(await within(item).findByRole("img", { name: "Review agent came back" })).toBeDefined();
    expect(within(item).queryByTestId("rail-review-count")).toBeNull();
  });

  it("splits the count into waiting, in progress, and ready", async () => {
    const item = addRailItem();
    const finished = { ...reviewThread, status: "idle", returned: "finished" } as const;
    renderOverlay(() =>
      ok({
        ...view([
          queuePr({ thread: finished }),
          queuePr({ number: 16, thread: reviewThread }),
          queuePr({ number: 17, thread: reviewThread }),
          queuePr({ number: 18 }),
          queuePr({ number: 19, review: "reviewed", thread: finished }),
        ]),
        hasReturned: true,
      }),
    );

    const waiting = await within(item).findByTestId("rail-review-count");
    expect(waiting.textContent).toBe("1 pull request needs review");
    expect(waiting.className).toContain("bg-red-600");
    const inProgress = within(item).getByTestId("rail-in-progress-count");
    expect(inProgress.textContent).toBe("2 reviews in progress");
    expect(inProgress.className).toContain("bg-orange-500");
    const ready = within(item).getByTestId("rail-ready-count");
    expect(ready.textContent).toBe("1 review ready for you");
    expect(ready.className).toContain("bg-green-600");
    expect(within(item).queryByRole("img", { name: "Review agent came back" })).toBeNull();
  });

  it("shows an X while auto-review is on and you are not working today, also with nothing waiting", async () => {
    const item = addRailItem();
    renderOverlay(() => ok({ ...view([]), autoReviewOn: true, workingDay: "2020-01-01" }));

    const off = await within(item).findByTestId("rail-not-working");
    expect(off.getAttribute("aria-label")).toBe("Not working today: auto-review is paused");
  });

  it("shows no X once you switched on working today, or while auto-review is off", async () => {
    const working = addRailItem();
    const slot = renderOverlay(() =>
      ok({ ...view([queuePr()]), autoReviewOn: true, workingDay: localDay(Date.now()) }),
    );
    await within(working).findByTestId("rail-review-count");
    expect(within(working).queryByTestId("rail-not-working")).toBeNull();

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok({ ...view([queuePr()]), autoReviewOn: false, workingDay: null }),
    );
    expect(within(working).queryByTestId("rail-not-working")).toBeNull();
  });

  it("attaches once the rail item appears", async () => {
    const slot = renderOverlay(() => ok(view([queuePr()])));
    await vi.waitFor(() =>
      expect(slot.inspection.rpcCalls.map((call) => call.method)).toEqual(["getReviewQueue"]),
    );

    const item = addRailItem();
    expect((await within(item).findByTestId("rail-review-count")).textContent).toBe(
      "1 pull request needs review",
    );
  });

  it("moves to a replaced rail item", async () => {
    const first = addRailItem();
    renderOverlay(() => ok(view([queuePr()])));
    await within(first).findByTestId("rail-review-count");

    first.remove();
    const second = addRailItem();
    expect(await within(second).findByTestId("rail-review-count")).toBeDefined();
  });

  it("clears when nothing waits any more", async () => {
    const item = addRailItem();
    const slot = renderOverlay(() => ok(view([queuePr()])));
    await within(item).findByTestId("rail-review-count");

    await slot.behavior.emitRealtime("review-queue.updated", ok(view([])));
    expect(item.textContent).toBe("");
  });

  it("removes the badge when unmounted", async () => {
    const item = addRailItem();
    const slot = renderOverlay(() => ok(view([queuePr()])));
    await within(item).findByTestId("rail-review-count");

    slot.unmount();
    expect(item.textContent).toBe("");
  });
});

describe("Pull Requests rail activity", () => {
  it("shows no dot for unread comments", async () => {
    const item = addRailItem();
    const slot = renderSlot<object, typeof rpcContract>(
      { component: overlay.component },
      {},
      {
        rpc: {
          ...panelRpc(() => ok(view([queuePr()]))),
          getActivity: () => activityOk([activityPr([activityItem()])]),
        },
      },
    );

    await within(item).findByTestId("rail-review-count");
    expect(slot.inspection.rpcCalls.map((call) => call.method)).not.toContain("getActivity");
    expect(within(item).queryByRole("img", { name: /unread comments/ })).toBeNull();
  });
});
