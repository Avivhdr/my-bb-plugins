import type { ReactNode } from "react";
import { CARD, QUIET_BUTTON } from "./styles";

export interface PendingCommentCardProps {
  body: string;
  onRemove: () => void;
  location?: ReactNode;
}

export function PendingCommentCard({ body, onRemove, location }: PendingCommentCardProps) {
  return (
    <article className={`${CARD} gap-1.5 border-border bg-background`} aria-label="Pending comment">
      <div className="flex min-h-6 min-w-0 items-center gap-2 text-xs">
        <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-border px-2 text-[11px] font-medium text-muted-foreground">
          Pending
        </span>
        {location}
        <button
          type="button"
          className={`${QUIET_BUTTON} -mr-1.5 ml-auto h-6 px-2`}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      <p className="whitespace-pre-wrap break-words leading-relaxed text-foreground">{body}</p>
    </article>
  );
}
