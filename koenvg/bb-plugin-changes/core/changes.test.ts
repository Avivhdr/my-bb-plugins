import { describe, expect, it } from "vitest";
import { targetKey, targetOf } from "./changes";

describe("targetKey", () => {
  it.each([
    [{ kind: "all" }, "all"],
    [{ kind: "uncommitted" }, "uncommitted"],
    [{ kind: "branch_committed" }, "branch_committed"],
    [{ kind: "commit", sha: "abc1234def" }, "commit:abc1234def"],
  ] as const)("names target %j as %s", (target, key) => {
    expect(targetKey(target)).toBe(key);
  });
});

describe("targetOf", () => {
  it.each([
    [{ target: "all", mergeBaseBranch: "origin/main" }, { kind: "all" }],
    [{ target: "uncommitted" }, { kind: "uncommitted" }],
    [{ target: "branch_committed", mergeBaseBranch: "origin/main" }, { kind: "branch_committed" }],
    [
      { target: "commit", sha: "abc1234def" },
      { kind: "commit", sha: "abc1234def" },
    ],
  ] as const)("gives the target of query %j", (query, target) => {
    expect(targetOf(query)).toEqual(target);
  });
});
