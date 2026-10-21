// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { InsightResult, rpcContract } from "../contract";
import type { Check } from "../core/checks";
import type { PrInsight } from "../core/overview";
import { forgetInsights } from "./pr-availability";

type ReadMethods = Pick<typeof rpcContract, "getInsight">;
const app = await loadPluginApp(() => import("../app"));
const tab = app.threadPanelActions.find((action) => action.id === "pr")!;

const insight: PrInsight = {
  pr: {
    number: 25707,
    title: "fix(libs-bound-shared): reset lifecycle chart total",
    state: "open",
    url: "https://github.com/o/r/pull/25707",
    headOid: "a",
    headRefName: "kvg/fix-total",
    headOwner: null,
    isCrossRepository: false,
    baseRefName: "main",
    author: "koenvg",
    additions: 42,
    deletions: 7,
    changedFiles: 3,
  },
  mergeAction: { kind: "none" },
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
  blockers: [],
  checks: [],
  reviewers: [],
  mergeQueue: null,
};

function check(name: string, status: Check["status"], required = false): Check {
  return { name, status, url: null, required, failure: null };
}

function renderTab(data: PrInsight) {
  const result: InsightResult = { kind: "ok", insight: data, refreshedAt: Date.now(), error: null };
  const panel = renderSlot<PluginThreadPanelProps, ReadMethods>(
    tab,
    { threadId: "thr_layout", params: null },
    { rpc: { getInsight: async () => result } },
  );
  return within(panel.container);
}

afterEach(() => {
  cleanup();
  forgetInsights();
});

describe("PR header", () => {
  it("shows the number, state, branches, diff size, author, and title", async () => {
    const view = renderTab(insight);

    expect(
      await view.findByText("fix(libs-bound-shared): reset lifecycle chart total"),
    ).toBeTruthy();
    for (const text of [
      "#25707",
      "Open",
      "kvg/fix-total → main",
      "+42",
      "-7",
      "3 files",
      "koenvg",
    ]) {
      expect(view.getByText(text)).toBeTruthy();
    }
  });

  it("names the fork owner of the head branch", async () => {
    const view = renderTab({
      ...insight,
      pr: { ...insight.pr, headRefName: "fix", headOwner: "alice" },
    });

    expect(await view.findByText("alice:fix → main")).toBeTruthy();
  });

  it("says file for one changed file", async () => {
    const view = renderTab({ ...insight, pr: { ...insight.pr, changedFiles: 1 } });

    expect(await view.findByText("1 file")).toBeTruthy();
  });
});

describe("Merge status card", () => {
  function card(view: ReturnType<typeof renderTab>) {
    return within(view.getByRole("region", { name: "Merge status" }));
  }

  function verdictOf(view: ReturnType<typeof renderTab>) {
    return card(view).getByRole("status", { name: "Merge verdict" }).textContent;
  }

  function blockerRows(view: ReturnType<typeof renderTab>) {
    return card(view).getByRole("list", { name: "Merge blockers" }).querySelectorAll(":scope > li");
  }

  it("says the PR can't merge yet and lists the only blocker", async () => {
    const view = renderTab({
      ...insight,
      blockers: [{ code: "review_required", text: "Review required" }],
    });
    await view.findByText("#25707");

    expect(verdictOf(view)).toBe("Can't merge yet1 blocker");
    expect(Array.from(blockerRows(view), (row) => row.textContent)).toEqual([
      expect.stringContaining("Review required"),
    ]);
  });

  it("lists every blocker in order, each once", async () => {
    const view = renderTab({
      ...insight,
      blockers: [
        { code: "conflicts", text: "Merge conflicts" },
        { code: "checks_failed", text: "1 check failed" },
        { code: "review_required", text: "Review required" },
      ],
    });
    await view.findByText("#25707");

    expect(verdictOf(view)).toBe("Can't merge yet3 blockers");
    expect(Array.from(blockerRows(view), (row) => row.textContent)).toEqual([
      expect.stringContaining("Merge conflicts"),
      expect.stringContaining("1 check failed"),
      expect.stringContaining("Review required"),
    ]);
    expect(view.getAllByText("1 check failed")).toHaveLength(1);
  });

  it("does not count Draft as a blocker", async () => {
    const view = renderTab({
      ...insight,
      pr: { ...insight.pr, state: "draft" },
      blockers: [
        { code: "review_required", text: "Review required" },
        { code: "draft", text: "Draft" },
      ],
    });
    await view.findByText("#25707");

    expect(verdictOf(view)).toBe("Can't merge yet1 blocker");
  });

  it("says a draft without other blockers is not ready for review", async () => {
    const view = renderTab({
      ...insight,
      pr: { ...insight.pr, state: "draft" },
      blockers: [{ code: "draft", text: "Draft" }],
    });
    await view.findByText("#25707");

    expect(verdictOf(view)).toBe("Draft, not ready for review");
  });

  it("shows a ready PR with its merge button in the card", async () => {
    const view = renderTab({ ...insight, mergeAction: { kind: "merge", method: "SQUASH" } });
    await view.findByText("#25707");

    expect(verdictOf(view)).toBe("Ready to merge");
    expect(card(view).getByRole("button", { name: "Squash and merge" })).toBeTruthy();
  });

  it("shows no card for a merged PR", async () => {
    const view = renderTab({ ...insight, pr: { ...insight.pr, state: "merged" } });
    await view.findByText("#25707");

    expect(view.queryByRole("region", { name: "Merge status" })).toBeNull();
  });

  it("puts Update branch on the out of date blocker", async () => {
    const view = renderTab({
      ...insight,
      canUpdateBranch: true,
      blockers: [{ code: "behind", text: "Branch out of date" }],
    });
    await view.findByText("#25707");

    const row = blockerRows(view)[0] as HTMLElement;
    expect(within(row).getByRole("button", { name: "Update branch" })).toBeTruthy();
    expect(view.getAllByRole("button", { name: "Update branch" })).toHaveLength(1);
  });

  it("links conflicts to GitHub's conflict page", async () => {
    const view = renderTab({
      ...insight,
      blockers: [{ code: "conflicts", text: "Merge conflicts" }],
    });
    await view.findByText("#25707");

    expect(card(view).getByRole("link", { name: "Resolve on GitHub" }).getAttribute("href")).toBe(
      "https://github.com/o/r/pull/25707/conflicts",
    );
  });

  it("lists the reviewers under the review blocker, always open", async () => {
    const view = renderTab({
      ...insight,
      blockers: [{ code: "review_required", text: "Review required" }],
      reviewers: [
        { name: "alice", kind: "user", state: "approved", codeOwner: false },
        { name: "ai-governance", kind: "team", state: "pending", codeOwner: true },
      ],
    });
    await view.findByText("#25707");

    const row = blockerRows(view)[0] as HTMLElement;
    expect(within(row).queryByRole("button")).toBeNull();
    const reviewers = within(row).getByRole("list", { name: "Reviewers" });
    expect(
      Array.from(reviewers.querySelectorAll("li"), (item: Element) => item.textContent),
    ).toEqual([expect.stringContaining("alice"), expect.stringContaining("ai-governance (team)")]);
    expect(view.queryByRole("region", { name: "Reviewers" })).toBeNull();
  });

  it("keeps the Reviewers section when no review blocker shows", async () => {
    const view = renderTab({
      ...insight,
      reviewers: [{ name: "alice", kind: "user", state: "approved", codeOwner: false }],
    });
    await view.findByText("#25707");

    expect(view.getByRole("region", { name: "Reviewers" })).toBeTruthy();
  });

  it("opens a check blocker in place to show its checks", async () => {
    const view = renderTab({
      ...insight,
      checks: [check("build", "failed"), check("lint", "failed"), check("unit", "passed")],
      blockers: [{ code: "checks_failed", text: "2 checks failed" }],
    });
    await view.findByText("#25707");
    const toggle = card(view).getByRole("button", { name: /2 checks failed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.hasAttribute("aria-controls")).toBe(false);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const shown = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(Array.from(shown.querySelectorAll("li"), (row: Element) => row.textContent)).toEqual([
      expect.stringContaining("build"),
      expect.stringContaining("lint"),
    ]);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("PR checks", () => {
  it("labels required checks", async () => {
    const view = renderTab({
      ...insight,
      checks: [check("build", "failed", true), check("lint-docs", "failed")],
    });

    const build = (await view.findByText("build")).closest("li")!;
    const lint = view.getByText("lint-docs").closest("li")!;
    expect(within(build).getByText("required")).toBeTruthy();
    expect(within(lint).queryByText("required")).toBeNull();
  });

  it("puts passed and skipped checks in one collapsed line", async () => {
    const view = renderTab({
      ...insight,
      checks: [check("unit", "passed"), check("e2e", "passed"), check("docs", "skipped")],
    });

    const line = await view.findByText("2 passed, 1 skipped");
    const group = line.closest("details")!;
    expect(group.open).toBe(false);

    fireEvent.click(line);

    expect(group.open).toBe(true);
    for (const name of ["unit", "e2e", "docs"]) {
      expect(within(group).getByText(name)).toBeTruthy();
    }
  });

  it("shows a failed check open above the collapsed passed line", async () => {
    const view = renderTab({
      ...insight,
      checks: [check("unit", "passed"), check("build", "failed")],
    });

    const failed = await view.findByText("build");
    const passed = view.getByText("1 passed");
    expect(failed.closest("details")).toBeNull();
    expect(failed.compareDocumentPosition(passed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
