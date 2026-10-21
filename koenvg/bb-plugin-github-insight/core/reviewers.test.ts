import { describe, expect, it } from "vitest";
import { buildReviewers, type ReviewNode, type ReviewRequestNode } from "./reviewers";

function teamRequest(slug: string, asCodeOwner = true): ReviewRequestNode {
  return { asCodeOwner, requestedReviewer: { __typename: "Team", slug } };
}

function userRequest(login: string, asCodeOwner = false): ReviewRequestNode {
  return { asCodeOwner, requestedReviewer: { __typename: "User", login } };
}

function review(
  login: string,
  state: ReviewNode["state"],
  typename: "User" | "Bot" = "User",
): ReviewNode {
  return { state, author: { __typename: typename, login } };
}

describe("buildReviewers", () => {
  it("lists a code owner team with an open request as pending", () => {
    expect(buildReviewers([teamRequest("ai-governance")], [])).toEqual([
      { name: "ai-governance", kind: "team", state: "pending", codeOwner: true },
    ]);
  });

  it("lists a user with an approving review as approved", () => {
    expect(buildReviewers([], [review("alice", "APPROVED")])).toEqual([
      { name: "alice", kind: "user", state: "approved", codeOwner: false },
    ]);
  });

  it("shows a re-requested reviewer as pending", () => {
    expect(buildReviewers([userRequest("bob")], [review("bob", "CHANGES_REQUESTED")])).toEqual([
      { name: "bob", kind: "user", state: "pending", codeOwner: false },
    ]);
  });

  it("maps each review state", () => {
    const reviewers = buildReviewers(
      [],
      [
        review("a", "APPROVED"),
        review("b", "CHANGES_REQUESTED"),
        review("c", "COMMENTED"),
        review("d", "DISMISSED"),
      ],
    );

    expect(reviewers.map((reviewer) => reviewer.state)).toEqual([
      "approved",
      "changes_requested",
      "commented",
      "dismissed",
    ]);
  });

  it("marks bot reviewers as bots", () => {
    expect(buildReviewers([], [review("renovate", "APPROVED", "Bot")])).toEqual([
      { name: "renovate", kind: "bot", state: "approved", codeOwner: false },
    ]);
  });

  it("drops requests and reviews without a visible reviewer", () => {
    expect(
      buildReviewers(
        [{ asCodeOwner: true, requestedReviewer: null }],
        [{ state: "APPROVED", author: null }],
      ),
    ).toEqual([]);
  });

  it("drops pending reviews that are not submitted", () => {
    expect(buildReviewers([], [review("carol", "PENDING")])).toEqual([]);
  });
});
