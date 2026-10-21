import { loadedReviewQueueSchema, type LoadedReviewQueue } from "./review-queue-view";

export const REVIEW_QUEUE_UPDATED_CHANNEL = "review-queue.updated";

export function readReviewQueueUpdate(payload: unknown): LoadedReviewQueue | null {
  const parsed = loadedReviewQueueSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
