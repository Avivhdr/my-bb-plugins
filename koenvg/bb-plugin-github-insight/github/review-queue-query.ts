import type { PullRequestRef } from "../core/pr-ref";
import { layerAlias, REVIEW_QUEUE_PAGE_SIZE, trackedAlias } from "../core/review-queue";

const PR_FRAGMENT = `
fragment QueuePr on PullRequest {
  number
  title
  url
  state
  mergedAt
  closedAt
  isDraft
  createdAt
  updatedAt
  author { login avatarUrl(size: 40) }
  repository { nameWithOwner }
  headRefName
  headRefOid
  reviewDecision
  labels(first: 20) { nodes { name } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}
`;

const ACTIVITY_FRAGMENT = `
fragment QueueActivity on PullRequest {
  comments(last: 10) { nodes { id createdAt author { __typename login } } }
  reviews(last: 10) {
    nodes { id submittedAt body author { __typename login } comments(first: 10) { nodes { id createdAt publishedAt } } }
  }
  timelineItems(last: 10, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } }
  }
}
`;

const BATCH_SIZE = 8;

interface IndexedRef {
  ref: PullRequestRef;
  index: number;
}

function variableDefinitions(layerCount: number, tracked: readonly IndexedRef[]): string {
  const definitions = [
    ...Array.from({ length: layerCount }, (_, i) => `$q${i}: String!`),
    ...tracked.map(({ index: i }) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`),
  ];
  return definitions.length === 0 ? "" : `(${definitions.join(", ")})`;
}

function layerFields(layerCount: number): string {
  return Array.from(
    { length: layerCount },
    (
      _,
      i,
    ) => `  ${layerAlias(i)}: search(type: ISSUE, first: ${REVIEW_QUEUE_PAGE_SIZE}, query: $q${i}) {
    issueCount
    nodes { ...QueuePr }
  }
`,
  ).join("");
}

function trackedFields(tracked: readonly IndexedRef[]): string {
  return tracked
    .map(
      ({ index: i }) =>
        `  ${trackedAlias(i)}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { ...QueuePr ...QueueActivity } }\n`,
    )
    .join("");
}

function variableArgs(tracked: readonly IndexedRef[]): string[] {
  return tracked.flatMap(({ ref: { owner, repo, number }, index: i }) => [
    "-f",
    `o${i}=${owner}`,
    "-f",
    `r${i}=${repo}`,
    "-F",
    `n${i}=${number}`,
  ]);
}

function queryArgs(layerQueries: readonly string[], tracked: readonly IndexedRef[]): string[] {
  const query = `
query${variableDefinitions(layerQueries.length, tracked)} {
  viewer { login }
${layerFields(layerQueries.length)}${trackedFields(tracked)}}
${PR_FRAGMENT}${tracked.length === 0 ? "" : ACTIVITY_FRAGMENT}`;
  const layerArgs = layerQueries.flatMap((layerQuery, i) => ["-f", `q${i}=${layerQuery}`]);
  return ["api", "graphql", "-f", `query=${query}`, ...layerArgs, ...variableArgs(tracked)];
}

/** One search per layer in the first request, and the tracked PRs, 8 per request. */
export function reviewQueueBatchArgs(
  layerQueries: readonly string[],
  tracked: readonly PullRequestRef[],
): string[][] {
  const refs = tracked.map((ref, index) => ({ ref, index }));
  const batches = [queryArgs(layerQueries, refs.slice(0, BATCH_SIZE))];
  for (let start = BATCH_SIZE; start < refs.length; start += BATCH_SIZE) {
    batches.push(queryArgs([], refs.slice(start, start + BATCH_SIZE)));
  }
  return batches;
}
