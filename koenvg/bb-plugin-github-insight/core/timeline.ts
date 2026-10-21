import { z } from "zod";
import { actorSchema } from "./actor";
import type { SignMedia } from "./signed-media";
import { othersPrComments, othersReviewTexts, type PostedComment } from "./new-comments";

const loginSchema = z.object({ login: z.string() }).nullable();

const lifecycleNode = <T extends string>(typename: T) =>
  z.object({
    __typename: z.literal(typename),
    id: z.string(),
    actor: loginSchema,
    createdAt: z.string(),
  });

const nodeSchema = z.discriminatedUnion("__typename", [
  z.object({
    __typename: z.literal("IssueComment"),
    id: z.string(),
    author: actorSchema,
    body: z.string(),
    bodyHTML: z.string(),
    createdAt: z.string(),
    url: z.string(),
  }),
  z.object({
    __typename: z.literal("PullRequestReview"),
    id: z.string(),
    author: actorSchema,
    state: z.enum(["PENDING", "COMMENTED", "APPROVED", "CHANGES_REQUESTED", "DISMISSED"]),
    body: z.string(),
    bodyHTML: z.string(),
    submittedAt: z.string().nullable(),
    url: z.string(),
    comments: z.object({
      totalCount: z.number(),
      nodes: z.array(z.object({ id: z.string() })),
    }),
  }),
  z.object({
    __typename: z.literal("PullRequestCommit"),
    id: z.string(),
    commit: z.object({
      oid: z.string(),
      messageHeadline: z.string(),
      committedDate: z.string(),
      author: z.object({ name: z.string().nullable(), user: loginSchema }).nullable(),
    }),
  }),
  lifecycleNode("ReadyForReviewEvent"),
  lifecycleNode("ClosedEvent"),
  lifecycleNode("ReopenedEvent"),
  lifecycleNode("MergedEvent"),
]);

const timelinePageSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }),
    repository: z.object({
      pullRequest: z.object({
        id: z.string(),
        body: z.string(),
        bodyHTML: z.string(),
        author: loginSchema,
        createdAt: z.string(),
        locked: z.boolean(),
        viewerCanUpdate: z.boolean(),
        timelineItems: z.object({
          pageInfo: z.object({
            hasPreviousPage: z.boolean(),
            startCursor: z.string().nullable(),
          }),
          nodes: z.array(nodeSchema),
        }),
      }),
    }),
  }),
});

const reviewStateSchema = z.enum(["commented", "approved", "changes_requested", "dismissed"]);
const lifecycleKindSchema = z.enum(["ready_for_review", "closed", "reopened", "merged"]);

const eventBase = { id: z.string(), actor: z.string().nullable(), at: z.string() };

export const timelineEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("comment"), ...eventBase, body: z.string(), url: z.string() }),
  z.object({
    kind: z.literal("review"),
    ...eventBase,
    state: reviewStateSchema,
    body: z.string(),
    url: z.string(),
    inlineCount: z.number(),
    inlineCommentIds: z.array(z.string()),
  }),
  z.object({ kind: z.literal("commit"), ...eventBase, oid: z.string(), headline: z.string() }),
  ...lifecycleKindSchema.options.map((kind) => z.object({ kind: z.literal(kind), ...eventBase })),
]);

export type TimelineEvent = z.infer<typeof timelineEventSchema>;
type CommitEvent = Extract<TimelineEvent, { kind: "commit" }>;

export type TimelineEntry =
  | Exclude<TimelineEvent, CommitEvent>
  | { kind: "commits"; id: string; actor: string | null; at: string; commits: CommitEvent[] };

export const prDescriptionSchema = z.object({
  body: z.string(),
  author: z.string().nullable(),
  at: z.string(),
});
export type PrDescription = z.infer<typeof prDescriptionSchema>;

export interface TimelinePage {
  prNodeId: string;
  description: PrDescription;
  locked: boolean;
  viewerCanUpdate: boolean;
  events: TimelineEvent[];
  othersComments: PostedComment[];
  olderCursor: string | null;
}

type Node = z.infer<typeof nodeSchema>;

const LIFECYCLE_KIND = {
  ReadyForReviewEvent: "ready_for_review",
  ClosedEvent: "closed",
  ReopenedEvent: "reopened",
  MergedEvent: "merged",
} as const;

function toEvent(node: Node, signMedia: SignMedia): TimelineEvent | null {
  switch (node.__typename) {
    case "IssueComment":
      return {
        kind: "comment",
        id: node.id,
        actor: node.author?.login ?? null,
        at: node.createdAt,
        body: signMedia(node.body, node.bodyHTML),
        url: node.url,
      };
    case "PullRequestReview":
      if (node.state === "PENDING" || node.submittedAt === null) return null;
      return {
        kind: "review",
        id: node.id,
        actor: node.author?.login ?? null,
        at: node.submittedAt,
        state: reviewStateSchema.parse(node.state.toLowerCase()),
        body: signMedia(node.body, node.bodyHTML),
        url: node.url,
        inlineCount: node.comments.totalCount,
        inlineCommentIds: node.comments.nodes.map(({ id }) => id),
      };
    case "PullRequestCommit": {
      const { author } = node.commit;
      return {
        kind: "commit",
        id: node.id,
        actor: author?.user?.login ?? author?.name ?? null,
        at: node.commit.committedDate,
        oid: node.commit.oid,
        headline: node.commit.messageHeadline,
      };
    }
    default:
      return {
        kind: LIFECYCLE_KIND[node.__typename],
        id: node.id,
        actor: node.actor?.login ?? null,
        at: node.createdAt,
      };
  }
}

function isMergeClose(node: Node, nodes: readonly Node[]): boolean {
  return (
    node.__typename === "ClosedEvent" &&
    nodes.some((other) => other.__typename === "MergedEvent" && other.createdAt === node.createdAt)
  );
}

type NodeOf<T extends Node["__typename"]> = Extract<Node, { __typename: T }>;

function othersCommentsOf(nodes: readonly Node[], viewer: string): PostedComment[] {
  const comments = nodes.filter(
    (node): node is NodeOf<"IssueComment"> => node.__typename === "IssueComment",
  );
  const reviews = nodes.filter(
    (node): node is NodeOf<"PullRequestReview"> => node.__typename === "PullRequestReview",
  );
  return [...othersPrComments(comments, viewer), ...othersReviewTexts(reviews, viewer)];
}

export function parseTimelinePage(response: unknown, signMedia: SignMedia): TimelinePage {
  const { viewer, repository } = timelinePageSchema.parse(response).data;
  const { pullRequest } = repository;
  const { nodes, pageInfo } = pullRequest.timelineItems;
  return {
    prNodeId: pullRequest.id,
    description: {
      body: signMedia(pullRequest.body, pullRequest.bodyHTML),
      author: pullRequest.author?.login ?? null,
      at: pullRequest.createdAt,
    },
    locked: pullRequest.locked,
    viewerCanUpdate: pullRequest.viewerCanUpdate,
    events: nodes.flatMap((node) => {
      if (isMergeClose(node, nodes)) return [];
      const event = toEvent(node, signMedia);
      return event === null ? [] : [event];
    }),
    othersComments: othersCommentsOf(nodes, viewer.login),
    olderCursor: pageInfo.hasPreviousPage ? pageInfo.startCursor : null,
  };
}

export function groupTimeline(events: readonly TimelineEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const event of events) {
    const last = entries.at(-1);
    if (event.kind !== "commit") entries.push(event);
    else if (last?.kind === "commits") {
      last.commits.push(event);
      last.at = event.at;
    } else
      entries.push({
        kind: "commits",
        id: event.id,
        actor: event.actor,
        at: event.at,
        commits: [event],
      });
  }
  return entries;
}

export function mergeEvents(
  earlier: readonly TimelineEvent[],
  later: readonly TimelineEvent[],
): TimelineEvent[] {
  const latest = new Map(later.map((event) => [event.id, event]));
  const known = new Set(earlier.map(({ id }) => id));
  return [
    ...earlier.map((event) => latest.get(event.id) ?? event),
    ...later.filter(({ id }) => !known.has(id)),
  ];
}
