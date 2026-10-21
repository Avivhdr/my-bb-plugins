// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../contract";
import { ok, panelRpc, queuePr, view, type QueueHandler } from "../test/review-queue-fixtures";

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
    expect(count.className).toContain("bg-primary");
  });

  it("shows the dot when a review agent came back", async () => {
    const item = addRailItem();
    renderOverlay(() => ok({ ...view([]), hasReturned: true }));

    expect(await within(item).findByRole("img", { name: "Review agent came back" })).toBeDefined();
    expect(within(item).queryByTestId("rail-review-count")).toBeNull();
  });

  it("attaches once the rail item appears", async () => {
    const slot = renderOverlay(() => ok(view([queuePr()])));
    await vi.waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(1));

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
