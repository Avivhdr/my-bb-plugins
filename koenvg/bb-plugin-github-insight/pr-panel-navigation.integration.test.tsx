// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { renderSidebarSlot as renderSlot } from "../bb-plugin-pr-thread-list/sidebar-actions.test-support";
import { project, thread } from "../bb-plugin-pr-thread-list/fixtures";
import { cancelPrPanelRequest } from "./pr-panel-navigation";
import { forgetInsights } from "./ui/pr-availability";

const insightApp = await loadPluginApp(() => import("./app"));
const sidebarApp = await loadPluginApp(() => import("../bb-plugin-pr-thread-list/app"));
const banner = insightApp.composerCustomizations.find((entry) => entry.id === "pr-insight")!
  .banners![0]!;
afterEach(() => {
  cleanup();
  forgetInsights();
  cancelPrPanelRequest();
  localStorage.clear();
});

function mountDestination(threadId: string) {
  return renderSlot(
    banner,
    {},
    {
      pluginId: "github-insight",
      context: { threadId },
      composer: { scope: { kind: "thread", threadId } },
      rpc: { getInsight: () => ({ kind: "no_pr" }) },
      openThreadPanel: () => true,
    },
  );
}

function mountSidebar(activeThreadId: string) {
  const onNavigate = vi.fn();
  const summary = {
    version: 1,
    updatedAt: new Date().toISOString(),
    pr: { number: 42, state: "open", url: "https://github.com/o/r/pull/42" },
    checks: { failed: 1, running: 0, cancelled: 0, passed: 0, skipped: 0, failedNames: ["test"] },
    reviewers: { pending: 0, approved: 0, changesRequested: 0, pendingNames: [] },
    blockers: ["checks_failed"],
    error: null,
  };
  const slot = renderSlot(
    sidebarApp.threadLists[0]!,
    {
      activeThreadId,
      activeProjectId: "p1",
      isCompactViewport: true,
      onNavigate,
      searchQuery: "",
    },
    {
      pluginId: "pr-thread-list",
      sidebarThreads: {
        threads: [
          thread({ id: "thread-a" }),
          thread({ id: "thread-b", displayTitle: "Destination" }),
        ],
        projects: [project],
        sections: [],
      },
      rpc: {
        listSummaries: () => ({ insightAvailable: true, summaries: { "thread-b": summary } }),
      },
    },
  );
  return { slot, onNavigate };
}

it("navigates from the sidebar to the correct destination and opens its owner-plugin PR action", async () => {
  const previous = mountDestination("thread-a");
  const { slot: sidebar, onNavigate } = mountSidebar("thread-a");
  fireEvent.click(
    await sidebar.findByRole("button", { name: "Open PR tab, PR #42: 1 failed check" }),
  );
  expect(sidebar.inspection.threadActionCalls).toEqual([{ method: "open", threadId: "thread-b" }]);
  expect(onNavigate).toHaveBeenCalledOnce();
  expect(previous.inspection.navigateCalls).toHaveLength(0);
  previous.lifecycle.unmount();

  const destination = mountDestination("thread-b");
  await waitFor(() =>
    expect(destination.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]),
  );
  expect(destination.inspection.rpcCalls).toContainEqual(
    expect.objectContaining({
      method: "getInsight",
      input: { threadId: "thread-b" },
    }),
  );
  expect(within(destination.container).queryByRole("button")).toBeNull();
  destination.lifecycle.unmount();
  const revisit = mountDestination("thread-b");
  expect(revisit.inspection.navigateCalls).toHaveLength(0);
  expect(previous.inspection.navigateCalls).toHaveLength(0);
});

it("also opens the PR action when the clicked thread is already mounted", async () => {
  const destination = mountDestination("thread-b");
  const { slot: sidebar } = mountSidebar("thread-b");
  const badge = await sidebar.findByRole("button", { name: "Open PR tab, PR #42: 1 failed check" });
  act(() => fireEvent.click(badge));
  expect(destination.inspection.navigateCalls).toEqual([
    { method: "openThreadPanel", options: { actionId: "pr" } },
  ]);
});
