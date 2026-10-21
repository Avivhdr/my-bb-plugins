import { describe, expect, it } from "vitest";
import {
  disableAutoMergeArgs,
  enableAutoMergeArgs,
  updatePullRequestBranchArgs,
} from "./branch-mutations";

const pullRequestId = "PR_kwDOHI7l-88AAAABEiddXg";
const expectedHeadOid = "2c850077d3529aa67c8178c80d09517377124ea9";

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))!;
}

describe("updatePullRequestBranchArgs", () => {
  it.each(["MERGE", "REBASE"] as const)(
    "passes the PR id, head commit, and %s as raw GraphQL variables",
    (updateMethod) => {
      const args = updatePullRequestBranchArgs({ pullRequestId, expectedHeadOid, updateMethod });

      expect(args).toEqual([
        "api",
        "graphql",
        "-f",
        expect.stringMatching(/^query=/),
        "-f",
        `pullRequestId=${pullRequestId}`,
        "-f",
        `expectedHeadOid=${expectedHeadOid}`,
        "-f",
        `updateMethod=${updateMethod}`,
      ]);
      expect(queryOf(args)).toContain("updatePullRequestBranch(");
      expect(queryOf(args)).not.toContain(pullRequestId);
    },
  );
});

describe("enableAutoMergeArgs", () => {
  it("passes the PR id, method, and head commit as raw GraphQL variables", () => {
    const args = enableAutoMergeArgs({ pullRequestId, mergeMethod: "SQUASH", expectedHeadOid });

    expect(args).toEqual([
      "api",
      "graphql",
      "-f",
      expect.stringMatching(/^query=/),
      "-f",
      `pullRequestId=${pullRequestId}`,
      "-f",
      "mergeMethod=SQUASH",
      "-f",
      `expectedHeadOid=${expectedHeadOid}`,
    ]);
    expect(queryOf(args)).toContain("enablePullRequestAutoMerge(");
    expect(queryOf(args)).not.toContain("SQUASH");
  });
});

describe("disableAutoMergeArgs", () => {
  it("passes the PR id as a raw GraphQL variable", () => {
    const args = disableAutoMergeArgs({ pullRequestId });

    expect(args).toEqual([
      "api",
      "graphql",
      "-f",
      expect.stringMatching(/^query=/),
      "-f",
      `pullRequestId=${pullRequestId}`,
    ]);
    expect(queryOf(args)).toContain("disablePullRequestAutoMerge(");
  });
});
