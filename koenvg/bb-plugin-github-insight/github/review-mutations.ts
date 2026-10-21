import type { AddPullRequestReviewRequest } from "../contract";

const ADD_REVIEW_MUTATION = `
mutation (
  $pullRequestId: ID!
  $commitOID: GitObjectID!
  $event: PullRequestReviewEvent!
  $body: String
  $threads: [DraftPullRequestReviewThread!]!
) {
  addPullRequestReview(
    input: { pullRequestId: $pullRequestId, commitOID: $commitOID, event: $event, body: $body, threads: $threads }
  ) {
    pullRequestReview { id state url }
  }
}
`;

// A large review does not fit in `-f` arguments, so the request goes on stdin.
export const ADD_REVIEW_ARGS = ["api", "graphql", "--input", "-"];

export function addPullRequestReviewInput({
  pullRequestId,
  commitOid,
  event,
  body,
  threads,
}: AddPullRequestReviewRequest): string {
  const variables = {
    pullRequestId,
    commitOID: commitOid,
    event,
    ...(body === "" ? {} : { body }),
    threads: threads.map(({ path, side, line, startLine, body }) => ({
      path,
      side,
      line,
      ...(startLine === null ? {} : { startLine, startSide: side }),
      body,
    })),
  };
  return JSON.stringify({ query: ADD_REVIEW_MUTATION, variables });
}

const ONE_PENDING_REVIEW = /one pending review per pull request/i;

export interface SubmitReviewError {
  message: string;
  url: string | null;
}

export function submitReviewError(message: string, prUrl: string): SubmitReviewError {
  if (!ONE_PENDING_REVIEW.test(message)) return { message, url: null };
  return {
    message: "You have a pending review on GitHub. Submit or delete it there, then submit again.",
    url: prUrl,
  };
}
