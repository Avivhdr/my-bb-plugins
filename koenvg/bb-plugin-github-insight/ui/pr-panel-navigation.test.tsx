// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { useEffect, useState } from "react";
import { useComposer } from "@get-bb/plugin-sdk/app";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { InsightResult, rpcContract } from "../contract";
import { cancelPrPanelRequest, requestPrPanel } from "../pr-panel-navigation";
import { useCommandIntent } from "./command-intents";
import { forgetInsights } from "./pr-availability";

const app = await loadPluginApp(() => import("../app"));
const banner = app.composerCustomizations.find((entry) => entry.id === "pr-insight")!.banners![0]!;
afterEach(() => {
  cleanup();
  forgetInsights();
  cancelPrPanelRequest();
});

it("opens the matching destination even when its blocker banner is hidden", async () => {
  requestPrPanel("thread-b", () => {});
  const slot = renderSlot<object, Pick<typeof rpcContract, "getInsight">>(
    banner,
    {},
    {
      composer: { scope: { kind: "thread", threadId: "thread-b" } },
      context: { threadId: "thread-b" },
      rpc: { getInsight: () => ({ kind: "no_pr" }) },
      openThreadPanel: () => true,
    },
  );
  await waitFor(() =>
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]),
  );
  expect(slot.queryByRole("button")).toBeNull();
});

const readyInsight: InsightResult = {
  kind: "ok",
  refreshedAt: Date.now(),
  error: null,
  insight: {
    pr: {
      number: 42,
      title: "Ready PR",
      state: "open",
      url: "https://github.com/o/r/pull/42",
      headOid: "head-42",
      headRefName: "feature",
      headOwner: null,
      isCrossRepository: false,
      baseRefName: "main",
      author: "koenvg",
      additions: 1,
      deletions: 0,
      changedFiles: 1,
    },
    mergeAction: { kind: "none" },
    mergeQueue: null,
    autoMergeAction: { kind: "none" },
    canUpdateBranch: false,
    blockers: [],
    reviewers: [],
    checks: [],
  },
};

function mount(
  threadId = "thread-b",
  getInsight: () => InsightResult | Promise<InsightResult> = () => readyInsight,
  openThreadPanel = () => true,
) {
  return renderSlot<object, Pick<typeof rpcContract, "getInsight">>(
    banner,
    {},
    {
      composer: { scope: { kind: "thread", threadId } },
      context: { threadId },
      rpc: { getInsight },
      openThreadPanel,
    },
  );
}

it("opens from an already-mounted receiver without waiting for insight", async () => {
  let resolve!: (result: InsightResult) => void;
  const slot = mount(
    "thread-b",
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => requestPrPanel("thread-b", () => {}));
  await waitFor(() =>
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]),
  );
  await act(async () => resolve(readyInsight));
  expect(slot.getByRole("button", { name: "Open" })).toBeTruthy();
  expect(slot.inspection.navigateCalls).toHaveLength(1);
});

it("uses the new thread scope and removes the old thread's receiver", async () => {
  const slot = mount("thread-a");
  act(() => requestPrPanel("thread-b", () => {}));
  expect(slot.inspection.navigateCalls).toHaveLength(0);
  await slot.behavior.setComposerScope({ kind: "thread", threadId: "thread-b" });
  expect(slot.inspection.navigateCalls).toEqual([
    { method: "openThreadPanel", options: { actionId: "pr" } },
  ]);
  act(() => requestPrPanel("thread-a", () => {}));
  expect(slot.inspection.navigateCalls).toHaveLength(1);
});

it("does not reopen a consumed request after remount and cleans up on unmount", async () => {
  requestPrPanel("thread-b", () => {});
  const first = mount();
  await waitFor(() => expect(first.inspection.navigateCalls).toHaveLength(1));
  first.lifecycle.unmount();
  const second = mount();
  expect(second.inspection.navigateCalls).toHaveLength(0);
  second.lifecycle.unmount();
  requestPrPanel("thread-b", () => {});
  expect(first.inspection.navigateCalls).toHaveLength(1);
  expect(second.inspection.navigateCalls).toHaveLength(0);
});

it("keeps a declined embedded-surface request for the destination side panel", async () => {
  const declined = vi.fn(() => false);
  const embedded = mount("thread-b", () => readyInsight, declined);
  act(() => requestPrPanel("thread-b", () => {}));
  await waitFor(() => expect(declined).toHaveBeenCalledOnce());
  embedded.lifecycle.unmount();
  const main = mount();
  await waitFor(() =>
    expect(main.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]),
  );
});

it("opens a visible compact PR panel when the destination mounts", async () => {
  const Banner = banner.component;
  let openDrawer = () => false;
  function CompactHost() {
    const { scope } = useComposer();
    const threadId = scope.kind === "thread" ? scope.threadId : null;
    const [drawerThreadId, setDrawerThreadId] = useState<string | null>(null);
    // BB resets its transient drawer on thread changes in a parent effect.
    useEffect(() => setDrawerThreadId(null), [threadId]);
    openDrawer = () => {
      setDrawerThreadId(threadId);
      return true;
    };
    return (
      <>
        <Banner />
        <aside aria-label="PR panel" hidden={drawerThreadId !== threadId}>
          PR
        </aside>
      </>
    );
  }
  requestPrPanel("thread-b", () => {});
  const slot = renderSlot(
    { component: CompactHost },
    {},
    {
      composer: { scope: { kind: "thread", threadId: "thread-b" } },
      context: { threadId: "thread-b" },
      rpc: { getInsight: () => readyInsight },
      openThreadPanel: () => openDrawer(),
    },
  );
  expect(await slot.findByRole("complementary", { name: "PR panel" })).toBeTruthy();
});

it("does not open an unmounted destination while registration is pending", async () => {
  requestPrPanel("thread-b", () => {});
  const abandoned = mount();
  abandoned.lifecycle.unmount();
  await act(async () => {});
  expect(abandoned.inspection.navigateCalls).toHaveLength(0);
  const destination = mount();
  await waitFor(() => expect(destination.inspection.navigateCalls).toHaveLength(1));
});

function listenForSubTab(threadId: string) {
  const received: string[] = [];
  renderHook(() => useCommandIntent(threadId, "pr", (intent) => received.push(intent)));
  return received;
}

it("selects Overview in the PR tab that the badge opens", async () => {
  const subTab = listenForSubTab("thread-sub-tab");
  const slot = mount("thread-sub-tab");
  act(() => requestPrPanel("thread-sub-tab", () => {}));
  await waitFor(() => expect(slot.inspection.navigateCalls).toHaveLength(1));
  expect(subTab).toEqual(["show-overview"]);
});

it("selects no sub-tab when the host declines the open", async () => {
  const subTab = listenForSubTab("thread-declined");
  const declined = vi.fn(() => false);
  mount("thread-declined", () => readyInsight, declined);
  act(() => requestPrPanel("thread-declined", () => {}));
  await waitFor(() => expect(declined).toHaveBeenCalled());
  expect(subTab).toEqual([]);
});
