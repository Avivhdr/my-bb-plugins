import { describe, expect, it } from "vitest";
import type { InsightResult } from "../contract";
import type { MergeAction } from "../core/merge-action";
import { canMerge, hasPr, insightSnapshot, rememberInsight } from "./pr-availability";

function ok(mergeAction: MergeAction): InsightResult {
  return {
    kind: "ok",
    insight: {
      pr: {
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
      },
      mergeAction,
      blockers: [],
      reviewers: [],
      checks: [],
      mergeQueue: null,
      autoMergeAction: { kind: "none" },
      canUpdateBranch: false,
    },
    refreshedAt: 0,
    error: null,
  };
}

describe("PR availability", () => {
  it("knows nothing about a thread before its first load", () => {
    expect(hasPr("thr_unknown")).toBe(false);
    expect(canMerge("thr_unknown")).toBe(false);
  });

  it("knows a PR that can merge or enqueue", () => {
    rememberInsight("thr_merge", ok({ kind: "merge", method: "SQUASH" }));
    rememberInsight("thr_enqueue", ok({ kind: "enqueue" }));

    expect([hasPr("thr_merge"), canMerge("thr_merge")]).toEqual([true, true]);
    expect([hasPr("thr_enqueue"), canMerge("thr_enqueue")]).toEqual([true, true]);
  });

  it.each([
    ["none", { kind: "none" }],
    ["queued", { kind: "queued" }],
  ] as const)("knows a PR that cannot merge (%s)", (_, mergeAction) => {
    rememberInsight("thr_blocked", ok(mergeAction));

    expect([hasPr("thr_blocked"), canMerge("thr_blocked")]).toEqual([true, false]);
  });

  it("forgets the PR when a later load has none", () => {
    rememberInsight("thr_gone", ok({ kind: "enqueue" }));
    rememberInsight("thr_gone", { kind: "no_pr" });

    expect([hasPr("thr_gone"), canMerge("thr_gone")]).toEqual([false, false]);
  });

  it("keeps the last good load when a load fails", () => {
    rememberInsight("thr_failed", ok({ kind: "enqueue" }));
    rememberInsight("thr_failed", { kind: "error", message: "rate limited" });

    expect([hasPr("thr_failed"), canMerge("thr_failed")]).toEqual([true, true]);
  });
  it.each(["draft", "closed", "merged"] as const)("rejects stale action data for %s", (state) => {
    const result = ok({ kind: "merge", method: "SQUASH" });
    if (result.kind !== "ok") throw new Error("Expected fixture insight");
    result.insight.pr.state = state;
    rememberInsight(`stale-${state}`, result);
    expect(hasPr(`stale-${state}`)).toBe(true);
    expect(canMerge(`stale-${state}`)).toBe(false);
  });
});

describe("insight snapshot", () => {
  it("has no snapshot before the first load", () => {
    expect(insightSnapshot("thr_snapshot_unknown")).toBeNull();
  });

  it("keeps the last PR result through a failed load", () => {
    const result = ok({ kind: "none" });
    rememberInsight("thr_snapshot", result);
    rememberInsight("thr_snapshot", { kind: "error", message: "gh not logged in" });

    expect(insightSnapshot("thr_snapshot")).toEqual(result);
  });

  it("keeps the PR result without the error of a failed refresh", () => {
    const failedRefresh = ok({ kind: "none" }) as Extract<InsightResult, { kind: "ok" }>;
    rememberInsight("thr_snapshot_error", { ...failedRefresh, error: "gh not logged in" });

    expect(insightSnapshot("thr_snapshot_error")?.error).toBeNull();
  });

  it("drops the snapshot when a later load has no PR", () => {
    rememberInsight("thr_snapshot_gone", ok({ kind: "none" }));
    rememberInsight("thr_snapshot_gone", { kind: "no_pr" });

    expect(insightSnapshot("thr_snapshot_gone")).toBeNull();
  });
});
