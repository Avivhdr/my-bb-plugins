import { isOtherPerson } from "./actor";

type Author = Parameters<typeof isOtherPerson>[0];

export interface PostedComment {
  id: string;
  postedAt: string;
}

export function postedAt(comment: { createdAt: string; publishedAt?: string | null }): string {
  return comment.publishedAt ?? comment.createdAt;
}

export function othersPrComments(
  comments: readonly { id: string; createdAt: string; author: Author }[],
  viewer: string,
): PostedComment[] {
  return comments
    .filter((comment) => isOtherPerson(comment.author, viewer))
    .map((comment) => ({ id: comment.id, postedAt: comment.createdAt }));
}

export function othersReviewTexts(
  reviews: readonly { id: string; submittedAt: string | null; body: string; author: Author }[],
  viewer: string,
): PostedComment[] {
  return reviews.flatMap(({ id, submittedAt, body, author }) =>
    submittedAt !== null && body !== "" && isOtherPerson(author, viewer)
      ? [{ id, postedAt: submittedAt }]
      : [],
  );
}

export function newCommentIds(
  comments: readonly PostedComment[],
  markedAt: number | null,
  seen: ReadonlySet<string>,
): string[] {
  if (markedAt === null) return [];
  return comments
    .filter((comment) => Date.parse(comment.postedAt) > markedAt && !seen.has(comment.id))
    .map((comment) => comment.id);
}
