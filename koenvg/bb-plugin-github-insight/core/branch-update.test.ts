import { describe, expect, it } from "vitest";
import { canUpdateBranch, type BranchUpdateInput } from "./branch-update";

const behind: BranchUpdateInput = {
  prState: "open",
  mergeable: "MERGEABLE",
  mergeStateStatus: "BEHIND",
  mergeQueue: null,
};

describe("canUpdateBranch", () => {
  it("offers an update for an open branch that is behind", () => {
    expect(canUpdateBranch(behind)).toBe(true);
  });

  it("offers an update for a draft branch that is behind", () => {
    expect(canUpdateBranch({ ...behind, prState: "draft" })).toBe(true);
  });

  it.each([
    ["a branch with conflicts", { mergeable: "CONFLICTING" }],
    ["an up-to-date branch", { mergeStateStatus: "CLEAN" }],
    ["a dirty branch", { mergeStateStatus: "DIRTY" }],
    ["a queued PR", { mergeQueue: { position: 1, state: "queued" } }],
    ["a merged PR", { prState: "merged" }],
    ["a closed PR", { prState: "closed" }],
  ] as const)("offers no update for %s", (_, overrides) => {
    expect(canUpdateBranch({ ...behind, ...overrides })).toBe(false);
  });
});
