import { z } from "zod";
import type { PullRequestRef } from "./pr-ref";

/**
 * Comments that need you, from the PRs in your GitHub notifications. The rules follow Beacon
 * (github.com/Avivhdr/beacon, Sources/Core/Classifier.swift):
 * - a mention of you or one of your teams counts, also in someone else's thread
 * - a new comment in an inline thread you wrote in is a reply
 * - on your PR: comments, change requests, and reviews or approvals with text count
 * - on someone else's PR: activity counts only after you first commented there, and a comment
 *   that mentions other people is addressed to them
 * - bots and your own activity never count
 */

export const ACTIVITY_LOOKBACK_MS = 3 * 24 * 3_600_000;
const SNIPPET_LENGTH = 200;

// --- Notifications ---------------------------------------------------------------------------

const notificationSchema = z.object({
  id: z.string(),
  unread: z.boolean(),
  reason: z.string(),
  updated_at: z.string(),
  last_read_at: z.string().nullable(),
  subject: z.object({ type: z.string(), url: z.string().nullable() }),
});

export interface PrNotification {
  threadId: string;
  ref: PullRequestRef;
  unread: boolean;
  updatedAt: string;
  lastReadAt: string | null;
}

const PULL_API_URL = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)$/;

/** Reads the pages of `gh api --paginate --slurp notifications`, PRs only. */
export function parseNotifications(pages: unknown): PrNotification[] {
  return z
    .array(z.array(notificationSchema))
    .parse(pages)
    .flat()
    .flatMap((notification) => {
      const match =
        notification.subject.type === "PullRequest"
          ? PULL_API_URL.exec(notification.subject.url ?? "")
          : null;
      if (match === null) return [];
      return [
        {
          threadId: notification.id,
          ref: { owner: match[1]!, repo: match[2]!, number: Number(match[3]) },
          unread: notification.unread,
          updatedAt: notification.updated_at,
          lastReadAt: notification.last_read_at,
        },
      ];
    });
}

// --- PR details ------------------------------------------------------------------------------

const authorSchema = z
  .object({
    __typename: z.string().optional(),
    login: z.string(),
    avatarUrl: z.string().optional(),
  })
  .nullable();
type Author = z.infer<typeof authorSchema>;

const commentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  author: authorSchema,
});

export const activityPrSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  author: authorSchema,
  repository: z.object({ nameWithOwner: z.string() }),
  comments: z.object({ nodes: z.array(commentSchema) }),
  reviews: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        body: z.string(),
        state: z.string(),
        submittedAt: z.string().nullable(),
        url: z.string(),
        author: authorSchema,
      }),
    ),
  }),
  reviewThreads: z.object({
    nodes: z.array(z.object({ comments: z.object({ nodes: z.array(commentSchema) }) })),
  }),
});
export type ActivityPrDetail = z.infer<typeof activityPrSchema>;

export function activityAlias(index: number): string {
  return `a${index}`;
}

/** Reads the batch responses of the activity query: the viewer and one PR per alias. */
export function parseActivityDetails(
  batchResponses: unknown,
  refs: readonly PullRequestRef[],
): { viewer: string; prs: (ActivityPrDetail | null)[] } {
  const batches = z
    .array(z.object({ data: z.record(z.string(), z.unknown()) }))
    .parse(batchResponses);
  const data = Object.assign({}, ...batches.map((batch) => batch.data)) as Record<string, unknown>;
  const viewer = z.object({ login: z.string() }).parse(data.viewer).login;
  const prs = refs.map((_, index) => {
    const node = z
      .object({ pullRequest: activityPrSchema.nullable() })
      .nullable()
      .optional()
      .parse(data[activityAlias(index)]);
    return node?.pullRequest ?? null;
  });
  return { viewer, prs };
}

// --- Classification --------------------------------------------------------------------------

export const activityKindSchema = z.enum([
  "mention",
  "team_mention",
  "reply",
  "comment",
  "changes_requested",
  "approved",
  "reviewed",
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

export const activityItemSchema = z.object({
  /** The GitHub node id of the comment or review. */
  id: z.string(),
  repo: z.string(),
  number: z.number(),
  kind: activityKindSchema,
  /** `org/slug` for a team mention. */
  team: z.string().nullable(),
  actor: z.string(),
  actorAvatarUrl: z.string().nullable(),
  snippet: z.string(),
  at: z.string(),
  url: z.string(),
  /** Where the PR view shows it: the conversation, or an inline thread in Files. */
  place: z.enum(["conversation", "inline"]),
});
export type ActivityItem = z.infer<typeof activityItemSchema>;

export interface ClassifyContext {
  me: string;
  /** Your teams as `org/slug`, for team mentions. */
  teams: readonly string[];
  /** Only activity after this time counts. */
  since: number;
}

type Source =
  | { kind: "comment" }
  | { kind: "review"; state: string }
  | { kind: "thread"; iCommentedEarlier: boolean };

function isBot(author: NonNullable<Author>): boolean {
  return author.__typename === "Bot" || author.login.toLowerCase().endsWith("[bot]");
}

function hasText(text: string): boolean {
  return text.trim().length > 0;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mentions(text: string, handle: string): boolean {
  return new RegExp(`(?<![A-Za-z0-9_/@-])@${escapeRegExp(handle)}(?![A-Za-z0-9_/-])`, "i").test(
    text,
  );
}

function mentionsAnyone(text: string): boolean {
  return /(?<![A-Za-z0-9_/@-])@[A-Za-z0-9][A-Za-z0-9-]*/.test(text);
}

/** Drops Markdown quote lines, so quoting a comment that mentions you is not a new mention. */
export function stripQuotes(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
}

export function snippetOf(text: string): string {
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>|!\[[^\]]*\]\([^)]*\)/g, "[image]")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "");
  const collapse = (value: string) => value.split(/\s+/).filter(Boolean).join(" ");
  let snippet = collapse(stripQuotes(plain));
  // A comment that is only a quote still says something, so show the quote.
  if (snippet === "") snippet = collapse(plain.replace(/^\s*>\s?/gm, ""));
  return snippet.length > SNIPPET_LENGTH ? `${snippet.slice(0, SNIPPET_LENGTH)}…` : snippet;
}

function kindOf(
  body: string,
  source: Source,
  isMyPr: boolean,
  participated: boolean,
  ctx: ClassifyContext,
): { kind: ActivityKind; team: string | null } | null {
  const unquoted = stripQuotes(body);
  if (mentions(unquoted, ctx.me)) return { kind: "mention", team: null };
  const team = ctx.teams.find((candidate) => mentions(unquoted, candidate));
  if (team !== undefined) return { kind: "team_mention", team };
  if (source.kind === "thread" && source.iCommentedEarlier) return { kind: "reply", team: null };
  if (!participated) return null;
  // On someone else's PR, a comment that mentions other people is addressed to them.
  if (!isMyPr && mentionsAnyone(unquoted)) return null;
  if (source.kind !== "review") return { kind: "comment", team: null };
  if (source.state === "CHANGES_REQUESTED") return { kind: "changes_requested", team: null };
  if (!hasText(body)) return null;
  if (source.state === "APPROVED") return { kind: "approved", team: null };
  // An empty COMMENTED review wraps inline comments, which come as threads.
  if (source.state === "COMMENTED" || source.state === "DISMISSED") {
    return { kind: "reviewed", team: null };
  }
  return null;
}

/** The items of one PR that need you, newest first. */
export function classifyPr(pr: ActivityPrDetail, ctx: ClassifyContext): ActivityItem[] {
  const me = ctx.me.toLowerCase();
  const isMe = (author: Author) => author?.login.toLowerCase() === me;
  const isMyPr = isMe(pr.author);
  const threads = pr.reviewThreads.nodes.map((thread) => thread.comments.nodes);
  // Only things you wrote count as taking part. A bare approval is not something anyone answers.
  const myActivity = [
    ...pr.comments.nodes.filter((comment) => isMe(comment.author)).map((c) => c.createdAt),
    ...pr.reviews.nodes
      .filter(
        (review) =>
          isMe(review.author) && (hasText(review.body) || review.state === "CHANGES_REQUESTED"),
      )
      .flatMap((review) => (review.submittedAt === null ? [] : [review.submittedAt])),
    ...threads
      .flat()
      .filter((comment) => isMe(comment.author))
      .map((c) => c.createdAt),
  ].map(Date.parse);
  const firstActivity = myActivity.length === 0 ? null : Math.min(...myActivity);

  const items: ActivityItem[] = [];
  function consider(
    entry: { id: string; author: Author; body: string; at: string; url: string },
    source: Source,
  ) {
    const at = Date.parse(entry.at);
    const author = entry.author;
    if (!(at > ctx.since) || author === null || isMe(author) || isBot(author)) return;
    const participated = isMyPr || (firstActivity !== null && firstActivity < at);
    const kind = kindOf(entry.body, source, isMyPr, participated, ctx);
    if (kind === null) return;
    const snippet = snippetOf(entry.body);
    items.push({
      id: entry.id,
      repo: pr.repository.nameWithOwner,
      number: pr.number,
      ...kind,
      actor: author.login,
      actorAvatarUrl: author.avatarUrl ?? null,
      snippet: snippet === "" && kind.kind === "changes_requested" ? "Requested changes" : snippet,
      at: entry.at,
      url: entry.url,
      place: source.kind === "thread" ? "inline" : "conversation",
    });
  }

  for (const comment of pr.comments.nodes) {
    consider({ ...comment, at: comment.createdAt }, { kind: "comment" });
  }
  for (const review of pr.reviews.nodes) {
    if (review.submittedAt === null) continue;
    consider({ ...review, at: review.submittedAt }, { kind: "review", state: review.state });
  }
  for (const thread of threads) {
    for (const comment of thread) {
      const created = Date.parse(comment.createdAt);
      const iCommentedEarlier = thread.some(
        (earlier) => isMe(earlier.author) && Date.parse(earlier.createdAt) < created,
      );
      consider({ ...comment, at: comment.createdAt }, { kind: "thread", iCommentedEarlier });
    }
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
