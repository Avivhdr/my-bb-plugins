import { describe, expect, it } from "vitest";
import { buildAutoMergeAction, type AutoMergeActionInput } from "./auto-merge";

const running = { code: "checks_running", text: "3 checks running" } as const;
const reviewRequired = { code: "review_required", text: "Review required" } as const;
const failed = { code: "checks_failed", text: "1 check failed" } as const;

const waitingForChecks: AutoMergeActionInput = {
  prState: "open",
  blockers: [running],
  isMergeQueueEnabled: false,
  autoMergeAllowed: true,
  autoMergeMethod: null,
  defaultMethod: "SQUASH",
  allowedMethods: { MERGE: true, SQUASH: true, REBASE: true },
};

describe("buildAutoMergeAction", () => {
  it("offers auto-merge with the default method while checks run", () => {
    expect(buildAutoMergeAction(waitingForChecks)).toEqual({ kind: "enable", method: "SQUASH" });
  });

  it("offers auto-merge while checks run and a review is required", () => {
    expect(
      buildAutoMergeAction({ ...waitingForChecks, blockers: [running, reviewRequired] }),
    ).toEqual({ kind: "enable", method: "SQUASH" });
  });

  it("offers auto-merge while a check waits for the user", () => {
    const waiting = { code: "checks_waiting", text: "UI Review waiting for you" } as const;
    expect(buildAutoMergeAction({ ...waitingForChecks, blockers: [waiting] })).toEqual({
      kind: "enable",
      method: "SQUASH",
    });
  });

  it.each([
    ["a failed check", { blockers: [failed] }],
    ["a draft", { prState: "draft" }],
    ["a closed PR", { prState: "closed" }],
    ["a repo without auto-merge", { autoMergeAllowed: false }],
    ["a merge queue repo", { isMergeQueueEnabled: true }],
    [
      "a default method the repo does not allow",
      { allowedMethods: { MERGE: true, SQUASH: false, REBASE: true } },
    ],
    ["a PR without blockers", { blockers: [] }],
  ] as const)("offers nothing for %s", (_, overrides) => {
    expect(buildAutoMergeAction({ ...waitingForChecks, ...overrides })).toEqual({ kind: "none" });
  });

  it("offers to disable auto-merge that is on, also with other blockers", () => {
    expect(
      buildAutoMergeAction({ ...waitingForChecks, blockers: [failed], autoMergeMethod: "MERGE" }),
    ).toEqual({ kind: "disable", method: "MERGE" });
  });

  it("offers to disable auto-merge on a draft", () => {
    expect(
      buildAutoMergeAction({ ...waitingForChecks, prState: "draft", autoMergeMethod: "SQUASH" }),
    ).toEqual({ kind: "disable", method: "SQUASH" });
  });

  it("offers nothing for a merged PR with an old auto-merge request", () => {
    expect(
      buildAutoMergeAction({ ...waitingForChecks, prState: "merged", autoMergeMethod: "SQUASH" }),
    ).toEqual({ kind: "none" });
  });
});
