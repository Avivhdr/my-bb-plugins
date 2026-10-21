import { describe, expect, it } from "vitest";
import { bannerParts } from "./banner";
import { buildBlockers, type Blocker } from "./blockers";
import type { PrInsight } from "./overview";
import type { Reviewer } from "./reviewers";

const pr: PrInsight["pr"] = {
  number: 1,
  title: "t",
  state: "open",
  url: "https://github.com/o/r/pull/1",
  headOid: "abc",
  headRefName: "feature",
  headOwner: null,
  isCrossRepository: false,
  baseRefName: "main",
  author: "koenvg",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
};

function pending(name: string): Reviewer {
  return { name, kind: "user", state: "pending", codeOwner: false };
}

function insight(blockers: Blocker[], reviewers: Reviewer[] = []): PrInsight {
  return {
    pr,
    mergeAction: { kind: "none" },
    autoMergeAction: { kind: "none" },
    canUpdateBranch: false,
    blockers,
    reviewers,
    checks: [],
    mergeQueue: null,
  };
}

const failed: Blocker = { code: "checks_failed", text: "2 checks failed" };
const running: Blocker = { code: "checks_running", text: "3 checks running" };
const behind: Blocker = { code: "behind", text: "Branch out of date" };
const reviewRequired: Blocker = { code: "review_required", text: "Review required" };

describe("bannerParts", () => {
  it("shows failed checks, pending reviews, and the top other blocker", () => {
    expect(bannerParts(insight([failed, behind, reviewRequired], [pending("a")]))).toEqual([
      "2 checks failed",
      "1 review pending",
      "Branch out of date",
    ]);
  });

  it("puts running checks after failed checks", () => {
    expect(bannerParts(insight([failed, running]))).toEqual([
      "2 checks failed",
      "3 checks running",
    ]);
  });

  it("puts waiting checks between failed and running checks", () => {
    const waiting: Blocker = { code: "checks_waiting", text: "UI Review waiting for you" };
    expect(bannerParts(insight([failed, waiting, running]))).toEqual([
      "2 checks failed",
      "UI Review waiting for you",
      "3 checks running",
    ]);
  });

  it("counts pending reviewers only", () => {
    const approved: Reviewer = { ...pending("c"), state: "approved" };
    expect(bannerParts(insight([reviewRequired], [pending("a"), pending("b"), approved]))).toEqual([
      "2 reviews pending",
    ]);
  });

  it("shows only the most important other blocker", () => {
    const conflicts: Blocker = { code: "conflicts", text: "Merge conflicts" };
    expect(bannerParts(insight([conflicts, behind]))).toEqual(["Merge conflicts"]);
  });

  it("shows review required when no reviewer is pending", () => {
    expect(bannerParts(insight([reviewRequired]))).toEqual(["Review required"]);
  });

  it("is empty for a PR without blockers", () => {
    expect(bannerParts(insight([], [pending("a")]))).toEqual([]);
  });

  it("is empty for a queued PR whose GitHub state reports blockers", () => {
    const queued = buildBlockers({
      prState: "open",
      mergeable: "MERGEABLE",
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      unresolvedThreads: 0,
      checks: [{ name: "build", status: "running" }],
      mergeQueue: { position: 2, state: "queued" },
    });

    expect(bannerParts(insight(queued, [pending("a")]))).toEqual([]);
  });

  it.each(["merged", "closed"] as const)("is empty for a %s PR", (state) => {
    expect(bannerParts({ ...insight([failed]), pr: { ...pr, state } })).toEqual([]);
  });
});
