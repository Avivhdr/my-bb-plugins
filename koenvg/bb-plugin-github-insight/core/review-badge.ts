import type { ReviewQueueView } from "./review-queue-view";

export interface ReviewBadge {
  count: string | null;
  unseen: boolean;
  returned: boolean;
}

export function reviewBadge(view: ReviewQueueView | null): ReviewBadge | null {
  if (view === null) return null;
  const waiting = view.needsReview.reduce((sum, group) => sum + group.prs.length, 0);
  if (waiting === 0 && !view.hasReturned) return null;
  return {
    count: waiting === 0 ? null : view.truncated ? "50+" : String(waiting),
    unseen: view.hasUnseen,
    returned: view.hasReturned,
  };
}
