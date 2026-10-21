// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { InsightResult, rpcContract } from "../contract";
import type { PrInsight } from "../core/overview";
import { forgetInsights } from "./pr-availability";

type StatusMethods = Pick<typeof rpcContract, "getInsight" | "refresh" | "runPrAction">;
const app = await loadPluginApp(() => import("../app"));
const banner = app.composerCustomizations.find((c) => c.id === "pr-insight")!.banners![0]!;
const tab = app.threadPanelActions.find((action) => action.id === "pr")!;
const pr = {
  number: 7,
  title: "Status parity",
  state: "open" as const,
  url: "https://github.com/o/r/pull/7",
  headOid: "a",
  headRefName: "feature",
  headOwner: null,
  isCrossRepository: false,
  baseRefName: "main",
  author: "koenvg",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
};
const emptyInsight: PrInsight = {
  pr,
  mergeAction: { kind: "none" },
  blockers: [],
  checks: [],
  reviewers: [],
  mergeQueue: null,
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
};
const blocked: PrInsight = {
  ...emptyInsight,
  blockers: [
    { code: "checks_failed", text: "2 checks failed" },
    { code: "behind", text: "Branch out of date" },
    { code: "review_required", text: "Review required" },
  ],
  reviewers: [{ name: "ai-governance", kind: "team", state: "pending", codeOwner: true }],
};
const ok = (insight: PrInsight): InsightResult => ({
  kind: "ok",
  insight,
  refreshedAt: 1,
  error: null,
});
const rpc = (result: InsightResult) => ({
  getInsight: () => result,
  refresh: () => result,
  runPrAction: () => {
    throw new Error("Status presentation must not write to GitHub");
  },
});
afterEach(() => {
  cleanup();
  forgetInsights();
});

function renderBanner(result: InsightResult) {
  return renderSlot<object, StatusMethods>(
    banner,
    {},
    {
      rpc: rpc(result),
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      openThreadPanel: () => true,
    },
  );
}
function renderTab(result: InsightResult) {
  return renderSlot<PluginThreadPanelProps, StatusMethods>(
    tab,
    { threadId: "thr_1", params: null },
    { rpc: rpc(result) },
  );
}

describe("PR state parity", () => {
  it.each([
    ["draft", "Draft"],
    ["open", "Open"],
    ["closed", "Closed"],
    ["merged", "Pull request merged"],
  ] as const)("keeps %s visible in both views without an action", async (state, label) => {
    const data = ok({ ...emptyInsight, pr: { ...pr, state } });
    const chat = renderBanner(data);
    const panel = renderTab(data);
    const status = await within(chat.container).findByRole("button", { name: label });
    await within(panel.container).findByText(label);
    expect(chat.container.querySelector("button button")).toBeNull();
    fireEvent.click(status);
    expect(chat.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]);
    expect(chat.inspection.rpcCalls.some(({ method }) => method === "runPrAction")).toBe(false);
  });

  it("keeps Draft beside failed checks and conflicts without repeating Draft in the banner", async () => {
    const data = ok({
      ...emptyInsight,
      pr: { ...pr, state: "draft" },
      blockers: [
        { code: "checks_failed", text: "1 check failed" },
        { code: "conflicts", text: "Merge conflicts" },
        { code: "draft", text: "Draft" },
      ],
    });
    const chat = renderBanner(data);
    const panel = renderTab(data);
    const button = await within(chat.container).findByRole("button", {
      name: /Draft.*1 check failed.*Merge conflicts/,
    });
    expect(button.textContent?.match(/Draft/g)).toHaveLength(1);
    await within(panel.container).findByRole("list", { name: "Merge blockers" });
    expect(panel.container.querySelector("[data-testid=pr-header]")?.textContent).toContain(
      "Draft",
    );
    expect(within(chat.container).queryByText(/Ready to/)).toBeNull();
  });

  it.each(["closed", "merged"] as const)(
    "suppresses stale details and actions for %s in both views",
    async (state) => {
      const data = ok({
        ...blocked,
        pr: { ...pr, state },
        mergeQueue: { position: 3, state: "failed" },
        mergeAction: { kind: "enqueue" },
      });
      const chat = renderBanner(data);
      const panel = renderTab(data);
      await within(chat.container).findByRole("button", {
        name: state === "closed" ? "Closed" : "Pull request merged",
      });
      await within(panel.container).findByText(
        state === "closed" ? "Closed" : "Pull request merged",
      );
      for (const container of [chat.container, panel.container]) {
        expect(within(container).queryByText("2 checks failed")).toBeNull();
        expect(within(container).queryByText("Merge queue failed")).toBeNull();
        expect(within(container).queryByRole("button", { name: "Enqueue" })).toBeNull();
      }
    },
  );

  it.each([
    ["queued", "In merge queue (#3)"],
    ["awaiting_checks", "Merge queue checks running (#3)"],
    ["merging", "Merging"],
    ["failed", "Merge queue failed"],
  ] as const)("shows matching %s queue detail in both views", async (state, text) => {
    const data = ok({
      ...blocked,
      mergeQueue: { position: 3, state },
      mergeAction: { kind: "queued" },
    });
    const chat = renderBanner(data);
    const panel = renderTab(data);
    await within(chat.container).findByText(text);
    await within(panel.container).findByText(text);
    expect(within(chat.container).getByText("Open")).toBeTruthy();
    for (const container of [chat.container, panel.container]) {
      expect(within(container).queryByText("2 checks failed")).toBeNull();
      expect(within(container).queryByText("Queued", { exact: true })).toBeNull();
      expect(within(container).queryByText("Pull request merged")).toBeNull();
      expect(within(container).queryByRole("button", { name: "Enqueue" })).toBeNull();
      if (state === "failed")
        expect(within(container).getByText(text).className).toContain("text-destructive");
    }
  });
});
