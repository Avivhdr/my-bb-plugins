// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { ActionResult, InsightResult, rpcContract } from "../contract";
import type { PrInsight } from "../core/overview";
import { forgetInsights } from "./pr-availability";

type Methods = Pick<typeof rpcContract, "getInsight" | "refresh" | "runPrAction" | "getTimeline">;
const app = await loadPluginApp(() => import("../app"));
const tab = app.threadPanelActions.find((action) => action.id === "pr")!;

const HEAD = "head-a";
const waiting: PrInsight = {
  pr: {
    number: 9,
    title: "Waits for checks",
    state: "open",
    url: "https://github.com/o/r/pull/9",
    headOid: HEAD,
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
  autoMergeAction: { kind: "enable", method: "SQUASH" },
  canUpdateBranch: false,
  blockers: [{ code: "checks_running", text: "3 checks running" }],
  checks: [],
  reviewers: [],
  mergeQueue: null,
};
const autoMergeOn: PrInsight = {
  ...waiting,
  autoMergeAction: { kind: "disable", method: "SQUASH" },
};

function renderTab(
  insight: PrInsight,
  runPrAction: (input: { action: string }) => ActionResult | Promise<ActionResult> = () => ({
    kind: "ok",
  }),
) {
  const result: InsightResult = { kind: "ok", insight, refreshedAt: Date.now(), error: null };
  const run = vi.fn(runPrAction);
  const slot = renderSlot<PluginThreadPanelProps, Methods>(
    tab,
    { threadId: "thr_auto", params: null },
    {
      rpc: {
        getInsight: async () => result,
        refresh: async () => result,
        runPrAction: run,
        getTimeline: () => ({ kind: "no_pr" as const }),
      },
    },
  );
  return { view: within(slot.container), run };
}

afterEach(() => {
  cleanup();
  forgetInsights();
});

describe("Auto-merge", () => {
  it("enables auto-merge with the default method at once, without a dialog", async () => {
    const { view, run } = renderTab(waiting);

    fireEvent.click(await view.findByRole("button", { name: "Enable auto-merge (squash)" }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toMatchObject({
      action: "enable-auto-merge",
      expectedHeadOid: HEAD,
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("offers nothing when the PR does not allow auto-merge", async () => {
    const { view } = renderTab({ ...waiting, autoMergeAction: { kind: "none" } });
    await view.findByText("#9");

    expect(view.queryByRole("button", { name: /auto-merge/i })).toBeNull();
    expect(view.queryByRole("button", { name: "Disable" })).toBeNull();
  });

  it("shows auto-merge that is on with a Disable button", async () => {
    const { view, run } = renderTab(autoMergeOn);

    const summary = await view.findByRole("status", { name: "Merge verdict" });
    expect(summary.textContent).toContain("Auto-merge on (squash)");
    fireEvent.click(within(summary).getByRole("button", { name: "Disable" }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toMatchObject({ action: "disable-auto-merge" });
  });

  it("shows Enabling… and sends one request for a double click", async () => {
    let finish!: (result: ActionResult) => void;
    const { view, run } = renderTab(waiting, () => new Promise((resolve) => (finish = resolve)));
    const button = await view.findByRole("button", { name: "Enable auto-merge (squash)" });

    fireEvent.click(button);
    fireEvent.click(button);

    expect(
      ((await view.findByRole("button", { name: "Enabling…" })) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: "ok" }));
  });

  it("shows Disabling… while auto-merge turns off", async () => {
    let finish!: (result: ActionResult) => void;
    const { view } = renderTab(autoMergeOn, () => new Promise((resolve) => (finish = resolve)));

    fireEvent.click(await view.findByRole("button", { name: "Disable" }));

    expect(await view.findByRole("button", { name: "Disabling…" })).toBeTruthy();
    await act(async () => finish({ kind: "ok" }));
  });

  it("shows the GitHub error and enables the button again", async () => {
    const { view } = renderTab(waiting, () => ({
      kind: "error",
      message: "Must have admin rights",
    }));

    fireEvent.click(await view.findByRole("button", { name: "Enable auto-merge (squash)" }));

    expect((await view.findByRole("alert")).textContent).toContain("Must have admin rights");
    expect(
      (view.getByRole("button", { name: "Enable auto-merge (squash)" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("keeps its own label but waits while another PR write runs", async () => {
    let finish!: (result: ActionResult) => void;
    const { view } = renderTab(
      { ...autoMergeOn, canUpdateBranch: true },
      () => new Promise((resolve) => (finish = resolve)),
    );

    fireEvent.click(await view.findByRole("button", { name: "Update branch" }));

    const disable = await view.findByRole("button", { name: "Disable" });
    await waitFor(() => expect((disable as HTMLButtonElement).disabled).toBe(true));
    expect(view.getByRole("button", { name: "Updating…" })).toBeTruthy();
    await act(async () => finish({ kind: "ok" }));
  });
});
