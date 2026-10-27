import { reviewBadge } from "../core/review-badge";
import { useActivity } from "./use-activity";
import { useReviewQueue } from "./use-review-queue";

const PILL = "rounded-full px-1.5 font-medium text-white";

export function PrSidebarBadge() {
  const badge = reviewBadge(useReviewQueue().view);
  const unreadActivity = useActivity().view?.unread ?? 0;
  if (badge === null && unreadActivity === 0) return null;
  const anyCount =
    badge !== null && (badge.waiting !== null || badge.inProgress > 0 || badge.ready > 0);
  return (
    <span className="flex items-center justify-end gap-1.5 text-xs tabular-nums">
      {unreadActivity > 0 && (
        <span
          role="img"
          aria-label={`${unreadActivity} unread comments`}
          className="size-1.5 shrink-0 rounded-full bg-attention"
        />
      )}
      {badge !== null && badge.waiting !== null && (
        <span data-testid="review-count" className={`${PILL} bg-red-600`}>
          {badge.waiting}
          {badge.unseen && <span className="sr-only">, new</span>}
        </span>
      )}
      {badge !== null && badge.inProgress > 0 && (
        <span data-testid="in-progress-count" className={`${PILL} bg-orange-500`}>
          {badge.inProgress}
          <span className="sr-only"> in progress</span>
        </span>
      )}
      {badge !== null && badge.ready > 0 && (
        <span data-testid="ready-count" className={`${PILL} bg-green-600`}>
          {badge.ready}
          <span className="sr-only"> ready for you</span>
        </span>
      )}
      {badge?.returned && !anyCount && (
        <span
          role="img"
          aria-label="Review agent came back"
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      )}
    </span>
  );
}
