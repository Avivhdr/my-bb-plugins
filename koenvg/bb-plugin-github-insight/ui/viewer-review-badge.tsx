import { useRef } from "react";
import type { ViewerReview } from "../core/pr-head";
import { relativeTime } from "../core/relative-time";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

const VERDICTS: Record<
  ViewerReview["state"],
  { text: string; icon: IconName; iconClass: string; pillClass: string }
> = {
  APPROVED: {
    text: "You approved",
    icon: "CircleCheck",
    iconClass: "text-success",
    pillClass: "bg-success/10",
  },
  CHANGES_REQUESTED: {
    text: "You requested changes",
    icon: "CircleX",
    iconClass: "text-destructive",
    pillClass: "bg-destructive/10",
  },
  COMMENTED: {
    text: "You commented",
    icon: "MessageSquare",
    iconClass: "text-muted-foreground",
    pillClass: "bg-muted",
  },
  DISMISSED: {
    text: "Your review was dismissed",
    icon: "Unavailable",
    iconClass: "text-muted-foreground",
    pillClass: "bg-muted",
  },
};

export function ViewerReviewBadge({
  review,
  headOid,
}: {
  review: ViewerReview | null;
  headOid: string;
}) {
  const reviewOnMount = useRef(review?.submittedAt);
  if (review === null) return null;

  const verdict = VERDICTS[review.state];
  const submittedAt = new Date(review.submittedAt);
  const justSubmitted = review.submittedAt !== reviewOnMount.current;
  const newCommits = review.commitOid !== null && review.commitOid !== headOid;
  return (
    <span
      key={review.submittedAt}
      title={submittedAt.toLocaleString()}
      className={cn(
        "inline-flex h-5 min-w-0 items-center gap-1 rounded-full pl-1.5 pr-2 text-foreground",
        verdict.pillClass,
        justSubmitted &&
          "duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in fade-in zoom-in-90 motion-reduce:zoom-in-100",
      )}
    >
      <Icon
        name={verdict.icon}
        className={cn(
          "size-3.5 shrink-0",
          verdict.iconClass,
          justSubmitted &&
            "duration-500 [animation-delay:150ms] ease-[cubic-bezier(0.16,1,0.3,1)] fill-mode-both animate-in fade-in zoom-in-150 spin-in-[-45deg] motion-reduce:animate-none",
        )}
      />
      <span className="truncate font-medium">{verdict.text}</span>
      <span className="shrink-0 text-muted-foreground">
        {relativeTime(submittedAt, new Date())}
      </span>
      {newCommits && (
        <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full bg-attention" />
          new commits since
        </span>
      )}
    </span>
  );
}
