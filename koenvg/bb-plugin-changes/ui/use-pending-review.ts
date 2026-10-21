import { useCallback, useSyncExternalStore } from "react";
import { pendingReviews, type PendingReview } from "../core/pending-review";

export function usePendingReview(threadId: string): PendingReview {
  const read = useCallback(() => pendingReviews.get(threadId), [threadId]);
  return useSyncExternalStore(pendingReviews.subscribe, read);
}
