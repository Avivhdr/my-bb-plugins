import { z } from "zod";
import { reviewDecisionSchema } from "./blockers";
import { actorSchema, isOtherPerson } from "./actor";
import { othersPrComments, othersReviewTexts, postedAt } from "./new-comments";
import type { PullRequestRef } from "./pr-ref";

export const REVIEW_QUEUE_PAGE_SIZE = 50;
export const TEAM_PR_WINDOW_MS = 7 * 24 * 3_600_000;

const GITHUB_REMOTE =
  /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i;

export function parseGithubRepo(remoteUrl: string | null): string | null {
  if (remoteUrl === null) return null;
  const match = GITHUB_REMOTE.exec(remoteUrl.trim());
  if (match === null) return null;
  return `${match[1]}/${match[2]}`.toLowerCase();
}

const rollupStateSchema = z.enum(["SUCCESS", "FAILURE", "ERROR", "PENDING", "EXPECTED"]);

const prNodeSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  mergedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  isDraft: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  repository: z.object({ nameWithOwner: z.string() }),
  headRefName: z.string(),
  headRefOid: z.string(),
  reviewDecision: reviewDecisionSchema,
  commits: z.object({
    nodes: z.array(
      z.object({
        commit: z.object({
          statusCheckRollup: z.object({ state: rollupStateSchema }).nullable(),
        }),
      }),
    ),
  }),
});
type PrNode = z.infer<typeof prNodeSchema>;

const trackedPrNodeSchema = prNodeSchema.extend({
  comments: z.object({
    nodes: z.array(z.object({ id: z.string(), createdAt: z.string(), author: actorSchema })),
  }),
  reviews: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        submittedAt: z.string().nullable(),
        body: z.string(),
        author: actorSchema,
        comments: z.object({
          nodes: z.array(
            z.object({ id: z.string(), createdAt: z.string(), publishedAt: z.string().nullable() }),
          ),
        }),
      }),
    ),
  }),
  timelineItems: z.object({
    nodes: z.array(
      z.object({ createdAt: z.string().optional(), requestedReviewer: actorSchema.optional() }),
    ),
  }),
});
type ActivityNode = z.infer<typeof trackedPrNodeSchema>;

const searchSchema = z.object({ issueCount: z.number(), nodes: z.array(prNodeSchema) });
type Search = z.infer<typeof searchSchema>;

const batchResponsesSchema = z.array(z.object({ data: z.record(z.string(), z.unknown()) }));

const reviewQueueDataSchema = z
  .object({
    viewer: z.object({ login: z.string() }),
    reviewRequests: searchSchema,
  })
  .catchall(z.unknown());

const trackedNodeSchema = z
  .object({ pullRequest: trackedPrNodeSchema.nullable() })
  .nullable()
  .optional();

export const ciStateSchema = z.enum(["passed", "failed", "running", "none"]);
export type CiState = z.infer<typeof ciStateSchema>;

const CI_STATE: Record<z.infer<typeof rollupStateSchema>, CiState> = {
  SUCCESS: "passed",
  FAILURE: "failed",
  ERROR: "failed",
  PENDING: "running",
  EXPECTED: "running",
};

const PR_STATE = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;

export const prStateSchema = z.enum(["open", "merged", "closed"]);
export type PrState = z.infer<typeof prStateSchema>;

const postedCommentSchema = z.object({ id: z.string(), postedAt: z.string() });

const prActivitySchema = z.object({
  conversationComments: z.array(postedCommentSchema),
  inlineComments: z.array(postedCommentSchema),
  lastRequestedAt: z.string().nullable(),
});
export type PrActivity = z.infer<typeof prActivitySchema>;

export const queuePrSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  author: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  draft: z.boolean(),
  ci: ciStateSchema,
  reviewDecision: reviewDecisionSchema,
  headRefName: z.string(),
  headOid: z.string(),
  url: z.string(),
  state: prStateSchema,
  closedAt: z.string().nullable(),
  activity: prActivitySchema.nullable().default(null),
});
export type QueuePr = z.infer<typeof queuePrSchema>;

export const queueListSchema = z.object({
  groups: z.array(z.object({ repo: z.string(), prs: z.array(queuePrSchema) })),
  truncated: z.boolean(),
});
export type QueueList = z.infer<typeof queueListSchema>;

export function trackedAlias(index: number): string {
  return `t${index}`;
}

export interface FetchedQueue {
  requests: QueueList;
  tracked: QueuePr[];
  gone: PullRequestRef[];
}

export function parseReviewQueue(
  batchResponses: unknown,
  trackedRefs: readonly PullRequestRef[],
  now: number,
): FetchedQueue {
  const batches = batchResponsesSchema.parse(batchResponses);
  const data = reviewQueueDataSchema.parse(
    Object.assign({}, ...batches.map((batch) => batch.data)),
  );
  const viewer = data.viewer.login;
  const tracked: QueuePr[] = [];
  const gone: PullRequestRef[] = [];
  trackedRefs.forEach((ref, index) => {
    const node = trackedNodeSchema.parse(data[trackedAlias(index)])?.pullRequest ?? null;
    if (node === null || closedBefore(node, now - TEAM_PR_WINDOW_MS)) gone.push(ref);
    else tracked.push({ ...toQueuePr(node), activity: activityOf(node, viewer) });
  });
  return { requests: toQueueList(data.reviewRequests), tracked, gone };
}

function closedBefore(node: PrNode, at: number): boolean {
  const closedAt = node.mergedAt ?? node.closedAt;
  return node.state !== "OPEN" && (closedAt === null || Date.parse(closedAt) < at);
}

function latest(times: string[]): string | null {
  return times.reduce<string | null>(
    (newest, at) => (newest === null || Date.parse(at) > Date.parse(newest) ? at : newest),
    null,
  );
}

function activityOf(node: ActivityNode, viewer: string): PrActivity {
  const reviews = node.reviews.nodes.filter(
    (review) => review.submittedAt !== null && isOtherPerson(review.author, viewer),
  );
  const inlineComments = reviews.flatMap((review) =>
    review.comments.nodes.map((comment) => ({ id: comment.id, postedAt: postedAt(comment) })),
  );
  const requestTimes = node.timelineItems.nodes.flatMap(({ createdAt, requestedReviewer }) =>
    createdAt !== undefined &&
    requestedReviewer?.__typename === "User" &&
    requestedReviewer.login === viewer
      ? [createdAt]
      : [],
  );
  return {
    conversationComments: [
      ...othersPrComments(node.comments.nodes, viewer),
      ...othersReviewTexts(node.reviews.nodes, viewer),
    ],
    inlineComments,
    lastRequestedAt: latest(requestTimes),
  };
}

function toQueuePr(node: PrNode): QueuePr {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup ?? null;
  return {
    repo: node.repository.nameWithOwner,
    number: node.number,
    title: node.title,
    author: node.author?.login ?? null,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    draft: node.isDraft,
    ci: rollup === null ? "none" : CI_STATE[rollup.state],
    reviewDecision: node.reviewDecision,
    headRefName: node.headRefName,
    headOid: node.headRefOid,
    url: node.url,
    state: PR_STATE[node.state],
    closedAt: node.mergedAt ?? node.closedAt,
    activity: null,
  };
}

function toQueueList(search: Search): QueueList {
  const byRepo = new Map<string, QueuePr[]>();
  for (const pr of search.nodes.map(toQueuePr)) {
    byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr]);
  }
  const groups = [...byRepo]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repo, prs]) => ({
      repo,
      prs: prs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)),
    }));
  return { groups, truncated: search.issueCount > REVIEW_QUEUE_PAGE_SIZE };
}
