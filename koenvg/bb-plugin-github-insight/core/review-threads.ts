import { z } from "zod";
import { isOtherPerson } from "./actor";
import { postedAt, type PostedComment } from "./new-comments";

export const MAX_THREAD_PAGES = 5;
export const MAX_COMMENT_BODY_CHARS = 4000;

const threadsPageSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }).optional(),
    repository: z.object({
      pullRequest: z.object({
        reviewThreads: z.object({
          pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
          nodes: z.array(
            z.object({
              id: z.string(),
              isResolved: z.boolean(),
              isOutdated: z.boolean(),
              path: z.string(),
              line: z.number().nullable(),
              originalLine: z.number().nullable(),
              diffSide: z.enum(["LEFT", "RIGHT"]),
              comments: z.object({
                totalCount: z.number(),
                nodes: z.array(
                  z.object({
                    id: z.string(),
                    author: z
                      .object({
                        __typename: z.string().optional(),
                        login: z.string(),
                        avatarUrl: z.string().optional(),
                      })
                      .nullable(),
                    body: z.string(),
                    bodyHTML: z.string(),
                    createdAt: z.string(),
                    publishedAt: z.string().nullable().optional(),
                    url: z.string(),
                    diffHunk: z.string(),
                  }),
                ),
              }),
            }),
          ),
        }),
      }),
    }),
  }),
});
type ThreadsPage = z.infer<typeof threadsPageSchema>;

export const reviewCommentSchema = z.object({
  id: z.string(),
  author: z.string(),
  avatarUrl: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
  diffHunk: z.string(),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

export const reviewThreadSchema = z.object({
  id: z.string(),
  resolved: z.boolean(),
  outdated: z.boolean(),
  path: z.string(),
  line: z.number().nullable(),
  originalLine: z.number().nullable(),
  side: z.enum(["LEFT", "RIGHT"]),
  comments: z.array(reviewCommentSchema),
  hasMoreComments: z.boolean(),
});
export type ReviewThread = z.infer<typeof reviewThreadSchema>;

export function capCommentBody(body: string): string {
  if (body.length <= MAX_COMMENT_BODY_CHARS) return body;
  return `${body.slice(0, MAX_COMMENT_BODY_CHARS)}\n[cut at ${MAX_COMMENT_BODY_CHARS} characters]`;
}

const GHOST_AUTHOR = "ghost";

type ThreadNode =
  ThreadsPage["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"][number];

function toReviewThread(node: ThreadNode): ReviewThread {
  return {
    id: node.id,
    resolved: node.isResolved,
    outdated: node.isOutdated,
    path: node.path,
    line: node.line,
    originalLine: node.originalLine,
    side: node.diffSide,
    comments: node.comments.nodes.map(({ id, author, body, createdAt, url, diffHunk }) => ({
      id,
      author: author?.login ?? GHOST_AUTHOR,
      avatarUrl: author?.avatarUrl ?? null,
      body,
      createdAt,
      url,
      diffHunk,
    })),
    hasMoreComments: node.comments.totalCount > node.comments.nodes.length,
  };
}

function threadsOf(page: ThreadsPage) {
  return page.data.repository.pullRequest.reviewThreads;
}

export function parseReviewThreads(pages: unknown[]): ReviewThread[] {
  return pages.flatMap((page) =>
    threadsOf(threadsPageSchema.parse(page)).nodes.map(toReviewThread),
  );
}

export interface CollectedReviewThreads {
  threads: ReviewThread[];
  othersComments: PostedComment[];
  bodyHtml: Map<string, string>;
  complete: boolean;
}

function othersCommentsOf(page: ThreadsPage): PostedComment[] {
  const viewer = page.data.viewer?.login;
  if (viewer === undefined) return [];
  return threadsOf(page).nodes.flatMap((thread) =>
    thread.comments.nodes
      .filter((comment) => isOtherPerson(comment.author, viewer))
      .map((comment) => ({ id: comment.id, postedAt: postedAt(comment) })),
  );
}

export async function collectReviewThreads(
  fetchPage: (after: string | null) => Promise<unknown>,
): Promise<CollectedReviewThreads> {
  const pages: ThreadsPage[] = [];
  let after: string | null = null;
  do {
    const page = threadsPageSchema.parse(await fetchPage(after));
    pages.push(page);
    const { pageInfo } = threadsOf(page);
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after !== null && pages.length < MAX_THREAD_PAGES);
  return {
    threads: pages.flatMap((page) => threadsOf(page).nodes.map(toReviewThread)),
    othersComments: pages.flatMap(othersCommentsOf),
    bodyHtml: new Map(
      pages.flatMap((page) =>
        threadsOf(page).nodes.flatMap((thread) =>
          thread.comments.nodes.map(({ id, bodyHTML }) => [id, bodyHTML] as const),
        ),
      ),
    ),
    complete: after === null,
  };
}
