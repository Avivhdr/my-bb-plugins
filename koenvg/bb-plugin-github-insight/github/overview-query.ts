import type { PrPageRequest } from "../contract";

const OVERVIEW_QUERY = `
query ($owner: String!, $repo: String!, $number: Int!, $after: String, $firstPage: Boolean!) {
  repository(owner: $owner, name: $repo) {
    ... @include(if: $firstPage) {
      viewerDefaultMergeMethod
      mergeCommitAllowed
      squashMergeAllowed
      rebaseMergeAllowed
      autoMergeAllowed
    }
    pullRequest(number: $number) {
      number
      title
      state
      isDraft
      url
      ... @include(if: $firstPage) {
        id
        headRefOid
        isMergeQueueEnabled
        mergeable
        mergeStateStatus
        mergeQueueEntry { position state }
        headRefName
        baseRefName
        isCrossRepository
        headRepositoryOwner { login }
        author { login }
        additions
        deletions
        changedFiles
        autoMergeRequest { mergeMethod }
        reviewDecision
        reviewRequests(first: 100) {
          nodes {
            asCodeOwner
            requestedReviewer {
              __typename
              ... on User { login }
              ... on Bot { login }
              ... on Mannequin { login }
              ... on Team { slug }
            }
          }
        }
        latestOpinionatedReviews(first: 100) {
          nodes { state author { __typename login } }
        }
        reviewThreads(first: 100) {
          nodes { isResolved }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100, after: $after) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  __typename
                  ... on CheckRun { id databaseId name status conclusion detailsUrl startedAt title summary isRequired(pullRequestNumber: $number) }
                  ... on StatusContext { context state description targetUrl createdAt isRequired(pullRequestNumber: $number) }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

// -f sends a raw string and -F coerces the value, so only the number uses -F.
export function overviewPageArgs(request: PrPageRequest): string[] {
  const args = [
    "api",
    "graphql",
    "-f",
    `query=${OVERVIEW_QUERY}`,
    "-f",
    `owner=${request.owner}`,
    "-f",
    `repo=${request.repo}`,
    "-F",
    `number=${request.number}`,
    "-F",
    `firstPage=${request.after === null}`,
  ];
  if (request.after !== null) args.push("-f", `after=${request.after}`);
  return args;
}
