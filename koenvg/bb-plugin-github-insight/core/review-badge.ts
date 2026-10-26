import type { ReviewQueueView } from "./review-queue-view";

export interface ReviewBadge {
  count: string | null;
  unseen: boolean;
  returned: boolean;
}

/** Counts the PRs waiting in the layers. Reviewed, merged, and ignored PRs never count. */
export function reviewBadge(view: ReviewQueueView | null): ReviewBadge | null {
  if (view === null) return null;
  const waiting = view.layers.reduce((sum, layer) => sum + layer.count, 0);
  if (waiting === 0 && !view.hasReturned) return null;
  const truncated = view.layers.some((layer) => layer.truncated);
  return {
    count: waiting === 0 ? null : truncated ? `${waiting}+` : String(waiting),
    unseen: view.hasUnseen,
    returned: view.hasReturned,
  };
}
