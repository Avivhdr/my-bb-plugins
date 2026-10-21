import type {
  DisableAutoMergeRequest,
  EnableAutoMergeRequest,
  UpdatePullRequestBranchRequest,
} from "../contract";

const UPDATE_BRANCH_MUTATION = `
mutation ($pullRequestId: ID!, $expectedHeadOid: GitObjectID!, $updateMethod: PullRequestBranchUpdateMethod!) {
  updatePullRequestBranch(
    input: { pullRequestId: $pullRequestId, expectedHeadOid: $expectedHeadOid, updateMethod: $updateMethod }
  ) {
    pullRequest { headRefOid }
  }
}
`;

export function updatePullRequestBranchArgs({
  pullRequestId,
  expectedHeadOid,
  updateMethod,
}: UpdatePullRequestBranchRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${UPDATE_BRANCH_MUTATION}`,
    "-f",
    `pullRequestId=${pullRequestId}`,
    "-f",
    `expectedHeadOid=${expectedHeadOid}`,
    "-f",
    `updateMethod=${updateMethod}`,
  ];
}

const ENABLE_AUTO_MERGE_MUTATION = `
mutation ($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!, $expectedHeadOid: GitObjectID!) {
  enablePullRequestAutoMerge(
    input: { pullRequestId: $pullRequestId, mergeMethod: $mergeMethod, expectedHeadOid: $expectedHeadOid }
  ) {
    pullRequest { autoMergeRequest { mergeMethod } }
  }
}
`;

export function enableAutoMergeArgs({
  pullRequestId,
  mergeMethod,
  expectedHeadOid,
}: EnableAutoMergeRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${ENABLE_AUTO_MERGE_MUTATION}`,
    "-f",
    `pullRequestId=${pullRequestId}`,
    "-f",
    `mergeMethod=${mergeMethod}`,
    "-f",
    `expectedHeadOid=${expectedHeadOid}`,
  ];
}

const DISABLE_AUTO_MERGE_MUTATION = `
mutation ($pullRequestId: ID!) {
  disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
    pullRequest { autoMergeRequest { mergeMethod } }
  }
}
`;

export function disableAutoMergeArgs({ pullRequestId }: DisableAutoMergeRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${DISABLE_AUTO_MERGE_MUTATION}`,
    "-f",
    `pullRequestId=${pullRequestId}`,
  ];
}
