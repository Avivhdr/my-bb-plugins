import { describe, expect, it } from "vitest";
import type { AddPullRequestReviewRequest } from "../contract";
import { ADD_REVIEW_ARGS, addPullRequestReviewInput, submitReviewError } from "./review-mutations";

const request: AddPullRequestReviewRequest = {
  pullRequestId: "PR_kwDOUoz3mM8AAAABGSCovQ",
  commitOid: "04b72695435c99fa6191dabebcd37de55730d7c1",
  event: "REQUEST_CHANGES",
  body: "Two problems",
  threads: [
    { path: "src/a.ts", side: "RIGHT", line: 42, startLine: null, body: "Null check missing" },
    { path: "src/a.ts", side: "RIGHT", line: 50, startLine: 45, body: "Extract a helper" },
    { path: "src/b.ts", side: "LEFT", line: 7, startLine: null, body: "Why remove this?" },
  ],
};

describe("addPullRequestReviewInput", () => {
  it("builds the query and variables for 3 comments with one range", () => {
    const { query, variables } = JSON.parse(addPullRequestReviewInput(request));

    expect(query).toContain("addPullRequestReview(");
    expect(variables).toEqual({
      pullRequestId: request.pullRequestId,
      commitOID: request.commitOid,
      event: "REQUEST_CHANGES",
      body: "Two problems",
      threads: [
        { path: "src/a.ts", side: "RIGHT", line: 42, body: "Null check missing" },
        {
          path: "src/a.ts",
          side: "RIGHT",
          line: 50,
          startLine: 45,
          startSide: "RIGHT",
          body: "Extract a helper",
        },
        { path: "src/b.ts", side: "LEFT", line: 7, body: "Why remove this?" },
      ],
    });
  });

  it("keeps the values out of the query text", () => {
    const { query } = JSON.parse(addPullRequestReviewInput(request));

    expect(query).not.toContain(request.pullRequestId);
    expect(query).not.toContain("Null check missing");
  });

  it("leaves out an empty body", () => {
    const { variables } = JSON.parse(
      addPullRequestReviewInput({ ...request, event: "APPROVE", body: "", threads: [] }),
    );

    expect(variables).toEqual({
      pullRequestId: request.pullRequestId,
      commitOID: request.commitOid,
      event: "APPROVE",
      threads: [],
    });
  });
});

describe("ADD_REVIEW_ARGS", () => {
  it("reads the request body from stdin", () => {
    expect(ADD_REVIEW_ARGS).toEqual(["api", "graphql", "--input", "-"]);
  });
});

describe("submitReviewError", () => {
  const prUrl = "https://github.com/koenvg/bb-plugins/pull/43";

  it("links the PR when the user already has a pending review", () => {
    expect(
      submitReviewError(
        "GraphQL: User can only have one pending review per pull request (addPullRequestReview)",
        prUrl,
      ),
    ).toEqual({
      message: "You have a pending review on GitHub. Submit or delete it there, then submit again.",
      url: prUrl,
    });
  });

  it("keeps other errors as they are, without a link", () => {
    expect(submitReviewError("gh not logged in", prUrl)).toEqual({
      message: "gh not logged in",
      url: null,
    });
  });
});
