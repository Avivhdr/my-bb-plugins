import { describe, expect, it } from "vitest";
import type { PrInsight } from "../core/overview";
import { prStatusView, prSummaryLine } from "./pr-status-view";

const base: PrInsight = {
  pr: {
    number: 1,
    title: "Status",
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
  mergeAction: { kind: "none" },
  blockers: [],
  checks: [],
  reviewers: [],
  mergeQueue: null,
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
};
const failed = { code: "checks_failed", text: "2 checks failed" } as const;
const conflict = { code: "conflicts", text: "Merge conflicts" } as const;

describe("PR status presentation", () => {
  it.each([
    ["draft", "Draft"],
    ["open", "Open"],
    ["closed", "Closed"],
    ["merged", "Pull request merged"],
  ] as const)("keeps %s visible without blockers or an action", (state, label) => {
    const status = prStatusView({ ...base, pr: { ...base.pr, state } });
    expect(status.lifecycle.text).toBe(label);
    expect(status.detail).toBeNull();
    expect(status.action).toBeNull();
  });

  it("keeps Draft beside blockers without duplicate Draft text or source mutation", () => {
    const insight: PrInsight = {
      ...base,
      pr: { ...base.pr, state: "draft" },
      blockers: [failed, { code: "draft", text: "Draft" }, conflict],
    };
    const before = structuredClone(insight);
    const status = prStatusView(insight);
    expect(status.lifecycle.text).toBe("Draft");
    expect(status.detail?.text).toBe("2 checks failed · Merge conflicts");
    expect(status.blockers).toEqual(insight.blockers);
    expect(insight).toEqual(before);
  });

  it.each(["draft", "closed", "merged"] as const)(
    "rejects contradictory actions for %s",
    (state) => {
      for (const mergeAction of [
        { kind: "merge", method: "SQUASH" },
        { kind: "enqueue" },
      ] as const) {
        const status = prStatusView({ ...base, pr: { ...base.pr, state }, mergeAction });
        expect(status.action).toBeNull();
        expect(status.detail).toBeNull();
      }
    },
  );

  it.each(["closed", "merged"] as const)(
    "suppresses obsolete blockers and queue detail for %s",
    (state) => {
      const status = prStatusView({
        ...base,
        pr: { ...base.pr, state },
        blockers: [failed],
        mergeAction: { kind: "queued" },
        mergeQueue: { position: 3, state: "failed" },
      });
      expect(status.detail).toBeNull();
      expect(status.blockers).toEqual([]);
      expect(status.action).toBeNull();
    },
  );

  it.each(["merge", "enqueue"] as const)("offers only a valid open %s action", (kind) => {
    const action = kind === "merge" ? { kind, method: "SQUASH" as const } : { kind };
    const status = prStatusView({ ...base, mergeAction: action });
    expect(status.lifecycle.text).toBe("Open");
    expect(status.detail?.text).toBe(kind === "merge" ? "Ready to merge" : "Ready to enqueue");
    expect(status.action).toEqual(action);
    expect(prStatusView({ ...base, mergeAction: action, blockers: [failed] }).action).toBeNull();
  });

  it.each([
    ["queued", "In merge queue (#3)", "text-muted-foreground"],
    ["awaiting_checks", "Merge queue checks running (#3)", "text-attention"],
    ["merging", "Merging", "text-success"],
    ["failed", "Merge queue failed", "text-destructive"],
  ] as const)("shows %s queue detail without blockers or an action", (state, text, tone) => {
    const status = prStatusView({
      ...base,
      mergeQueue: { position: 3, state },
      blockers: [failed],
      mergeAction: { kind: "enqueue" },
    });
    expect(status.lifecycle.text).toBe("Open");
    expect(status.detail).toMatchObject({ kind: "queue", text, iconClassName: tone });
    expect(status.blockers).toEqual([]);
    expect(status.action).toBeNull();
  });
});

describe("PR summary line", () => {
  const review = { code: "review_required", text: "Review required" } as const;

  it("shows the only blocker", () => {
    expect(prSummaryLine({ ...base, blockers: [review] })).toMatchObject({
      text: "Review required",
      more: 0,
    });
  });

  it("shows the first blocker and how many more", () => {
    expect(prSummaryLine({ ...base, blockers: [conflict, failed, review] })).toMatchObject({
      text: "Merge conflicts",
      more: 2,
    });
  });

  it("leaves out Draft, which the state label already shows", () => {
    const draft = { ...base.pr, state: "draft" } as const;
    expect(
      prSummaryLine({ ...base, pr: draft, blockers: [{ code: "draft", text: "Draft" }] }),
    ).toBeNull();
    expect(
      prSummaryLine({ ...base, pr: draft, blockers: [review, { code: "draft", text: "Draft" }] }),
    ).toMatchObject({ text: "Review required", more: 0 });
  });

  it.each([
    ["merge", "Ready to merge"],
    ["enqueue", "Ready to enqueue"],
  ] as const)("shows a PR ready to %s", (kind, text) => {
    const mergeAction =
      kind === "merge" ? ({ kind, method: "SQUASH" } as const) : ({ kind } as const);
    expect(prSummaryLine({ ...base, mergeAction })).toMatchObject({ text, more: 0 });
  });

  it("shows the merge queue state instead of blockers", () => {
    expect(
      prSummaryLine({ ...base, blockers: [review], mergeQueue: { position: 2, state: "queued" } }),
    ).toMatchObject({ text: "In merge queue (#2)", more: 0 });
  });

  it("shows auto-merge that is on instead of blockers", () => {
    expect(
      prSummaryLine({
        ...base,
        blockers: [review],
        autoMergeAction: { kind: "disable", method: "SQUASH" },
      }),
    ).toMatchObject({ text: "Auto-merge on (squash)", more: 0 });
  });

  it.each(["merged", "closed"] as const)("shows nothing for a %s PR", (state) => {
    expect(prSummaryLine({ ...base, pr: { ...base.pr, state }, blockers: [review] })).toBeNull();
  });
});
