import { reviewBadge } from "../core/review-badge";
import { useReviewQueue } from "./use-review-queue";

export function PrSidebarBadge() {
  const badge = reviewBadge(useReviewQueue().view);
  if (badge === null) return null;
  return (
    <span className="flex items-center justify-end gap-1.5 text-xs tabular-nums">
      {badge.count !== null && (
        <span
          data-testid="review-count"
          className={
            badge.unseen
              ? "rounded-full bg-primary px-1.5 font-medium text-primary-foreground"
              : "text-muted-foreground"
          }
        >
          {badge.count}
          {badge.unseen && <span className="sr-only">, new</span>}
        </span>
      )}
      {badge.returned && (
        <span
          role="img"
          aria-label="Review agent came back"
          className="size-1.5 shrink-0 rounded-full bg-primary"
        />
      )}
    </span>
  );
}
