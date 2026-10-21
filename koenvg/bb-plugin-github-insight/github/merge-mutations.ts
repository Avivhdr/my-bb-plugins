import type { EnqueuePullRequestRequest, MergePullRequestRequest } from "../contract";

const MERGE_MUTATION = `
mutation ($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) {
  mergePullRequest(
    input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }
  ) {
    pullRequest { state }
  }
}
`;

export function mergePullRequestArgs({
  pullRequestId,
  mergeMethod,
  expectedHeadOid,
}: MergePullRequestRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${MERGE_MUTATION}`,
    "-f",
    `pullRequestId=${pullRequestId}`,
    "-f",
    `mergeMethod=${mergeMethod}`,
    "-f",
    `expectedHeadOid=${expectedHeadOid}`,
  ];
}

const ENQUEUE_MUTATION = `
mutation ($pullRequestId: ID!, $expectedHeadOid: GitObjectID!) {
  enqueuePullRequest(input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid }) {
    mergeQueueEntry { state }
  }
}
`;

export function enqueuePullRequestArgs({
  pullRequestId,
  expectedHeadOid,
}: EnqueuePullRequestRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${ENQUEUE_MUTATION}`,
    "-f",
    `pullRequestId=${pullRequestId}`,
    "-f",
    `expectedHeadOid=${expectedHeadOid}`,
  ];
}
