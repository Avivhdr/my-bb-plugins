import type { DiffSide } from "../../review-ui/diff-lines";

export interface CommentAnchor {
  path: string;
  side: DiffSide;
  line: number;
}

export interface PendingComment extends CommentAnchor {
  id: string;
  body: string;
}

export interface OpenForm {
  anchor: CommentAnchor;
  text: string;
}

export interface PendingReview {
  comments: readonly PendingComment[];
  openForms: ReadonlyMap<string, OpenForm>;
}

export const EMPTY_REVIEW: PendingReview = { comments: [], openForms: new Map() };

export function anchorKey({ path, side, line }: CommentAnchor): string {
  return `${side}:${line}:${path}`;
}

export function createPendingReviewStore(newId: () => string = () => crypto.randomUUID()) {
  const reviews = new Map<string, PendingReview>();
  const listeners = new Set<() => void>();

  function update(threadId: string, change: (review: PendingReview) => PendingReview) {
    reviews.set(threadId, change(reviews.get(threadId) ?? EMPTY_REVIEW));
    for (const listener of listeners) listener();
  }

  function withForms(
    review: PendingReview,
    change: (forms: Map<string, OpenForm>) => void,
  ): PendingReview {
    const openForms = new Map(review.openForms);
    change(openForms);
    return { ...review, openForms };
  }

  return {
    get: (threadId: string): PendingReview => reviews.get(threadId) ?? EMPTY_REVIEW,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    openForm(threadId: string, anchor: CommentAnchor) {
      const key = anchorKey(anchor);
      if (reviews.get(threadId)?.openForms.has(key)) return;
      update(threadId, (review) =>
        withForms(review, (forms) => forms.set(key, { anchor, text: "" })),
      );
    },
    setFormText(threadId: string, anchor: CommentAnchor, text: string) {
      update(threadId, (review) =>
        withForms(review, (forms) => forms.set(anchorKey(anchor), { anchor, text })),
      );
    },
    closeForm(threadId: string, anchor: CommentAnchor) {
      update(threadId, (review) => withForms(review, (forms) => forms.delete(anchorKey(anchor))));
    },
    addComment(threadId: string, anchor: CommentAnchor, body: string) {
      update(threadId, (review) => ({
        comments: [...review.comments, { ...anchor, id: newId(), body }],
        openForms: withForms(review, (forms) => forms.delete(anchorKey(anchor))).openForms,
      }));
    },
    removeComments(threadId: string, ids: readonly string[]) {
      const removed = new Set(ids);
      update(threadId, (review) => ({
        ...review,
        comments: review.comments.filter((comment) => !removed.has(comment.id)),
      }));
    },
  };
}

export type PendingReviewStore = ReturnType<typeof createPendingReviewStore>;

export const pendingReviews = createPendingReviewStore();
