import { describe, expect, it } from "vitest";
import { presentPullRequest } from "./pr-status";
import type { BlockerCode, PrState, PrSummary } from "./pr-insight";

const pr = (
  state: PrState,
  blockers: BlockerCode[] = [],
  overrides: Partial<PrSummary> = {},
): PrSummary => ({
  number: 42,
  url: "https://example.com/pull/42",
  state,
  failedChecks: 0,
  passedChecks: 0,
  runningChecks: 0,
  waitingChecks: 0,
  pendingReviews: 0,
  blockers,
  failedNames: [],
  pendingNames: [],
  mergeQueue: null,
  ...overrides,
});

const icons = (view: ReturnType<typeof presentPullRequest>) => view.marks.map((mark) => mark.icon);

describe("pull request presentation", () => {
  it.each([
    ["draft", [], "GitPullRequestDraft", [], null, "draft"],
    ["open", ["behind"], "GitPullRequest", [], null, "branch out of date"],
    ["open", ["checks_running"], "GitPullRequest", ["Spinner"], null, "checks running"],
    ["open", ["checks_failed"], "GitPullRequest", ["CircleX"], "Checks failed", "checks failed"],
    ["open", ["review_required"], "GitPullRequest", ["Eye"], null, "awaiting review"],
    [
      "open",
      ["changes_requested"],
      "GitPullRequest",
      ["Edit"],
      "Changes requested",
      "changes requested",
    ],
    [
      "open",
      ["unresolved_threads"],
      "GitPullRequest",
      ["MessageSquare"],
      null,
      "unresolved comments",
    ],
    ["open", ["conflicts"], "GitPullRequest", ["AlertCircle"], "Conflicts", "merge conflicts"],
    ["open", ["blocked"], "GitPullRequest", ["Lock"], "Blocked", "merge blocked"],
    ["open", [], "GitPullRequest", [], "Ready", "ready to merge"],
    ["merged", [], "GitMerge", [], "Merged", "merged"],
    ["closed", [], "GitPullRequestClosed", [], null, "closed"],
  ] as const)(
    "maps %s with blockers %j to its icons and words",
    (state, blockers, lead, marks, word, status) => {
      const view = presentPullRequest(pr(state, [...blockers]));
      expect(view).toMatchObject({ lead, word, label: `PR #42: ${status}` });
      expect(icons(view)).toEqual(marks);
    },
  );
  it.each([
    [{ passedChecks: 4 }, "passed", "PR #42\nAll checks passed"],
    [{ passedChecks: 4, runningChecks: 1 }, "running", "PR #42\nChecks running"],
    [{ passedChecks: 4, failedChecks: 1 }, "failed", "PR #42\nChecks failed"],
    [{ passedChecks: 5, waitingChecks: 1 }, "waiting", "PR #42\nChecks waiting for you"],
    [{}, "unknown", "PR #42"],
  ] as const)("colours the PR icon for counts %j as checks %s", (counts, checks, leadTitle) => {
    expect(presentPullRequest(pr("open", [], counts))).toMatchObject({ checks, leadTitle });
  });
  it("does not colour checks for a merged or closed PR", () => {
    expect(presentPullRequest(pr("merged", [], { failedChecks: 2 })).checks).toBe("unknown");
    expect(presentPullRequest(pr("closed", ["checks_failed"])).lead).toBe("GitPullRequestClosed");
  });
  it("shows a check that waits for the user with a still mark after failed checks", () => {
    const view = presentPullRequest(
      pr("open", ["review_required", "checks_waiting", "checks_failed"], {
        failedChecks: 1,
        waitingChecks: 1,
        pendingReviews: 1,
      }),
    );
    expect(view.label).toBe("PR #42: 1 failed check, 1 check waiting for you, 1 review pending");
    expect(view.marks[1]).toEqual({
      icon: "UserRound",
      count: 1,
      spin: false,
      tone: "waiting",
      title: "1 check waiting for you",
    });
  });
  it("shows every blocker, problems first, each with its own tooltip", () => {
    const view = presentPullRequest(
      pr("open", ["behind", "review_required", "checks_running", "conflicts"], {
        runningChecks: 6,
        pendingReviews: 2,
        pendingNames: ["ana", "core-team (team)"],
      }),
    );
    expect(view).toMatchObject({
      word: "Conflicts",
      tone: "problem",
      label: "PR #42: merge conflicts, 6 checks running, 2 reviews pending, branch out of date",
    });
    expect(view.marks).toEqual([
      { icon: "AlertCircle", count: null, spin: false, tone: "problem", title: "Merge conflicts" },
      { icon: "Spinner", count: 6, spin: true, tone: "waiting", title: "6 checks running" },
      {
        icon: "Eye",
        count: 2,
        spin: false,
        tone: "waiting",
        title: "2 reviews pending\nWaiting on: ana, core-team (team)",
      },
    ]);
  });
  it.each([
    ["queued", "Queued #3", "waiting", [], "queued #3"],
    ["awaiting_checks", "Queued #3", "waiting", ["Spinner"], "queue checks running #3"],
    ["merging", "Merging", "ready", [], "merging"],
    ["failed", "Queue failed", "problem", ["CircleX"], "merge queue failed"],
  ] as const)(
    "maps merge queue state %s to its word, tone, and marks",
    (state, word, tone, marks, status) => {
      const view = presentPullRequest(
        pr("open", [], { passedChecks: 4, mergeQueue: { position: 3, state } }),
      );
      expect(view).toMatchObject({
        lead: "GitPullRequest",
        word,
        tone,
        label: `PR #42: ${status}`,
      });
      expect(icons(view)).toEqual(marks);
    },
  );
  it("gives the queue marks their tooltips", () => {
    const running = presentPullRequest(
      pr("open", [], { mergeQueue: { position: 3, state: "awaiting_checks" } }),
    );
    const failed = presentPullRequest(
      pr("open", [], { mergeQueue: { position: 3, state: "failed" } }),
    );
    expect(running.marks).toEqual([
      {
        icon: "Spinner",
        count: null,
        spin: true,
        tone: "waiting",
        title: "Queue checks running #3",
      },
    ]);
    expect(failed.marks).toEqual([
      { icon: "CircleX", count: null, spin: false, tone: "problem", title: "Merge queue failed" },
    ]);
  });
  it("shows a queued PR as queued, not ready or blocked", () => {
    const view = presentPullRequest(
      pr("open", ["blocked", "review_required"], { mergeQueue: { position: 1, state: "queued" } }),
    );
    expect(view).toMatchObject({
      word: "Queued #1",
      tone: "waiting",
      marks: [],
      label: "PR #42: queued #1",
    });
  });
  it("counts failed checks and lists their names", () => {
    const failed = presentPullRequest(
      pr("open", ["checks_failed"], { failedChecks: 2, failedNames: ["lint", "e2e"] }),
    );
    expect(failed.marks).toEqual([
      {
        icon: "CircleX",
        count: 2,
        spin: false,
        tone: "problem",
        title: "2 failed checks\nFailed: lint, e2e",
      },
    ]);
    expect(failed.label).toBe("PR #42: 2 failed checks");
  });
});
