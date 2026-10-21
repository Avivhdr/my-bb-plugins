import { describe, expect, it } from "vitest";
import { enqueuePullRequestArgs, mergePullRequestArgs } from "./merge-mutations";

const request = {
  pullRequestId: "PR_kwDOHI7l-88AAAABEiddXg",
  mergeMethod: "SQUASH",
  expectedHeadOid: "2c850077d3529aa67c8178c80d09517377124ea9",
} as const;

describe("mergePullRequestArgs", () => {
  it("passes the PR id, method, and head commit as raw GraphQL variables", () => {
    const args = mergePullRequestArgs(request);

    expect(args).toEqual([
      "api",
      "graphql",
      "-f",
      expect.stringMatching(/^query=/),
      "-f",
      `pullRequestId=${request.pullRequestId}`,
      "-f",
      "mergeMethod=SQUASH",
      "-f",
      `expectedHeadOid=${request.expectedHeadOid}`,
    ]);
  });

  it("keeps the values out of the query text", () => {
    const query = mergePullRequestArgs(request).find((arg) => arg.startsWith("query="))!;

    expect(query).toContain("mergePullRequest(");
    expect(query).not.toContain(request.pullRequestId);
    expect(query).not.toContain(request.expectedHeadOid);
    expect(query).not.toContain("SQUASH");
  });
});

describe("enqueuePullRequestArgs", () => {
  const enqueue = {
    pullRequestId: request.pullRequestId,
    expectedHeadOid: request.expectedHeadOid,
  };

  it("passes the PR id and head commit as raw GraphQL variables", () => {
    expect(enqueuePullRequestArgs(enqueue)).toEqual([
      "api",
      "graphql",
      "-f",
      expect.stringMatching(/^query=/),
      "-f",
      `pullRequestId=${enqueue.pullRequestId}`,
      "-f",
      `expectedHeadOid=${enqueue.expectedHeadOid}`,
    ]);
  });

  it("keeps the values out of the query text", () => {
    const query = enqueuePullRequestArgs(enqueue).find((arg) => arg.startsWith("query="))!;

    expect(query).toContain("enqueuePullRequest(");
    expect(query).not.toContain(enqueue.pullRequestId);
    expect(query).not.toContain(enqueue.expectedHeadOid);
  });
});
