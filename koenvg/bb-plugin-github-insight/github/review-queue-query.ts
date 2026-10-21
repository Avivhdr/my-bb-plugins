import type { PullRequestRef } from "../core/pr-ref";
import { REVIEW_QUEUE_PAGE_SIZE, trackedAlias } from "../core/review-queue";

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
  author { login }
  repository { nameWithOwner }
  headRefName
  headRefOid
  reviewDecision
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

const REVIEW_REQUESTS = `  reviewRequests: search(type: ISSUE, first: ${REVIEW_QUEUE_PAGE_SIZE}, query: "is:pr is:open review-requested:@me") {
    issueCount
    nodes { ...QueuePr }
  }
`;

interface IndexedRef {
  ref: PullRequestRef;
  index: number;
}

function variableDefinitions(tracked: readonly IndexedRef[]): string {
  if (tracked.length === 0) return "";
  const definitions = tracked.map(
    ({ index: i }) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`,
  );
  return `(${definitions.join(", ")})`;
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

function queryArgs(tracked: readonly IndexedRef[], extraFields: string): string[] {
  const query = `
query${variableDefinitions(tracked)} {
  viewer { login }
${extraFields}${trackedFields(tracked)}}
${PR_FRAGMENT}${tracked.length === 0 ? "" : ACTIVITY_FRAGMENT}`;
  return ["api", "graphql", "-f", `query=${query}`, ...variableArgs(tracked)];
}

export function reviewQueueBatchArgs(tracked: readonly PullRequestRef[]): string[][] {
  const refs = tracked.map((ref, index) => ({ ref, index }));
  const batches = [queryArgs(refs.slice(0, BATCH_SIZE), REVIEW_REQUESTS)];
  for (let start = BATCH_SIZE; start < refs.length; start += BATCH_SIZE) {
    batches.push(queryArgs(refs.slice(start, start + BATCH_SIZE), ""));
  }
  return batches;
}
