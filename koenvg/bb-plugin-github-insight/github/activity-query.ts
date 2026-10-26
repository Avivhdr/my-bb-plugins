import { activityAlias } from "../core/activity";
import type { PullRequestRef } from "../core/pr-ref";

const BATCH_SIZE = 8;

const AUTHOR = "author { __typename login avatarUrl(size: 40) }";

const ACTIVITY_FRAGMENT = `
fragment ActivityPr on PullRequest {
  number
  title
  url
  state
  author { login }
  repository { nameWithOwner }
  comments(last: 50) { nodes { id body createdAt url ${AUTHOR} } }
  reviews(last: 50) { nodes { id body state submittedAt url ${AUTHOR} } }
  reviewThreads(last: 50) { nodes { comments(first: 50) { nodes { id body createdAt url ${AUTHOR} } } } }
}
`;

/** One GraphQL request per 8 PRs, each PR at its own alias, with the viewer in every request. */
export function activityBatchArgs(prs: readonly PullRequestRef[]): string[][] {
  const batches: string[][] = [];
  for (let start = 0; start < prs.length; start += BATCH_SIZE) {
    const batch = prs.slice(start, start + BATCH_SIZE).map((ref, offset) => ({
      ref,
      index: start + offset,
    }));
    const definitions = batch
      .map(({ index: i }) => `$o${i}: String!, $r${i}: String!, $n${i}: Int!`)
      .join(", ");
    const fields = batch
      .map(
        ({ index: i }) =>
          `  ${activityAlias(i)}: repository(owner: $o${i}, name: $r${i}) { pullRequest(number: $n${i}) { ...ActivityPr } }\n`,
      )
      .join("");
    const query = `
query(${definitions}) {
  viewer { login }
${fields}}
${ACTIVITY_FRAGMENT}`;
    batches.push([
      "api",
      "graphql",
      "-f",
      `query=${query}`,
      ...batch.flatMap(({ ref: { owner, repo, number }, index: i }) => [
        "-f",
        `o${i}=${owner}`,
        "-f",
        `r${i}=${repo}`,
        "-F",
        `n${i}=${number}`,
      ]),
    ]);
  }
  return batches;
}

export function notificationsArgs(since: string): string[] {
  return [
    "api",
    "--paginate",
    "--slurp",
    `notifications?participating=true&all=true&per_page=50&since=${encodeURIComponent(since)}`,
  ];
}

export function markNotificationReadArgs(threadId: string): string[] {
  if (!/^\d+$/.test(threadId)) throw new Error(`Not a notification thread id: ${threadId}`);
  return ["api", "--method", "PATCH", `notifications/threads/${threadId}`];
}
