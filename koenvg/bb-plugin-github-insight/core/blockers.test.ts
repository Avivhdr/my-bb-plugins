import { describe, expect, it } from "vitest";
import { buildBlockers, type BlockerInput } from "./blockers";
import type { Check } from "./checks";

function input(overrides: Partial<BlockerInput> = {}): BlockerInput {
  return {
    prState: "open",
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    reviewDecision: null,
    unresolvedThreads: 0,
    checks: [],
    mergeQueue: null,
    ...overrides,
  };
}

function codes(overrides: Partial<BlockerInput>) {
  return buildBlockers(input(overrides)).map((blocker) => blocker.code);
}

const check = (name: string, status: Check["status"]) => ({ name, status });
const checks = [
  check("lint", "failed"),
  check("e2e", "failed"),
  check("build", "running"),
  check("unit", "passed"),
];

describe("buildBlockers", () => {
  it("gives review_required without blocked when a review is required", () => {
    expect(codes({ reviewDecision: "REVIEW_REQUIRED" })).toEqual(["review_required"]);
  });

  it("gives behind when the branch is out of date", () => {
    expect(buildBlockers(input({ mergeStateStatus: "BEHIND" }))).toEqual([
      { code: "behind", text: "Branch out of date" },
    ]);
  });

  it("gives an empty list for a PR that is ready to merge", () => {
    expect(codes({ mergeStateStatus: "CLEAN", unresolvedThreads: 2 })).toEqual([]);
  });

  it("gives an empty list for a merged or closed PR", () => {
    expect(codes({ prState: "merged", mergeStateStatus: "DIRTY" })).toEqual([]);
    expect(codes({ prState: "closed", mergeStateStatus: "DIRTY" })).toEqual([]);
  });

  it("gives an empty list for a queued PR that GitHub reports as blocked", () => {
    expect(
      codes({
        mergeQueue: { position: 1, state: "queued" },
        mergeStateStatus: "BLOCKED",
        reviewDecision: "REVIEW_REQUIRED",
      }),
    ).toEqual([]);
  });

  it("gives an empty list for a failed queue entry", () => {
    expect(
      codes({
        mergeQueue: { position: 1, state: "failed" },
        mergeable: "CONFLICTING",
        checks,
      }),
    ).toEqual([]);
  });

  it("gives blocked only when no other code explains it", () => {
    expect(buildBlockers(input())).toEqual([{ code: "blocked", text: "Blocked by branch rules" }]);
  });

  it("does not give blocked when GitHub is still computing the merge state", () => {
    expect(codes({ mergeStateStatus: "UNKNOWN" })).toEqual([]);
  });

  it("orders all codes from most to least important", () => {
    expect(
      codes({
        prState: "draft",
        mergeable: "CONFLICTING",
        mergeStateStatus: "BEHIND",
        reviewDecision: "CHANGES_REQUESTED",
        unresolvedThreads: 3,
        checks,
      }),
    ).toEqual([
      "conflicts",
      "checks_failed",
      "changes_requested",
      "behind",
      "unresolved_threads",
      "checks_running",
      "draft",
    ]);
    expect(codes({ reviewDecision: "REVIEW_REQUIRED", unresolvedThreads: 1, checks })).toEqual([
      "checks_failed",
      "review_required",
      "unresolved_threads",
      "checks_running",
    ]);
  });

  it("counts failed checks, running checks, and unresolved threads in the text", () => {
    expect(
      buildBlockers(input({ unresolvedThreads: 1, checks })).map((blocker) => blocker.text),
    ).toEqual(["2 checks failed", "1 unresolved thread", "1 check running"]);
  });

  it("names a single waiting check and does not count it as running", () => {
    expect(buildBlockers(input({ checks: [check("UI Review", "waiting")] }))).toEqual([
      { code: "checks_waiting", text: "UI Review waiting for you" },
    ]);
  });

  it("counts several waiting checks in the text", () => {
    const waiting = [check("UI Review", "waiting"), check("Visual QA", "waiting")];
    expect(buildBlockers(input({ checks: waiting })).map((blocker) => blocker.text)).toEqual([
      "2 checks waiting for you",
    ]);
  });

  it("puts waiting checks directly after failed checks", () => {
    const mixed = [check("lint", "failed"), check("UI Review", "waiting"), check("e2e", "running")];
    expect(codes({ reviewDecision: "CHANGES_REQUESTED", checks: mixed })).toEqual([
      "checks_failed",
      "checks_waiting",
      "changes_requested",
      "checks_running",
    ]);
  });

  it("gives conflicts when GitHub reports the merge state as dirty", () => {
    expect(codes({ mergeable: "UNKNOWN", mergeStateStatus: "DIRTY" })).toEqual(["conflicts"]);
  });
});
