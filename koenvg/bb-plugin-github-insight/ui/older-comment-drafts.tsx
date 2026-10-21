import { useId } from "react";
import { newCommitsText } from "../core/comment-draft-view";
import type { ListedCommentDraft } from "../core/review-drafts";
import { Icon } from "@/components/ui/icon";
import { CommentDraftCard } from "./comment-drafts";

export function OlderCommentDrafts({
  drafts,
  headOid,
}: {
  drafts: readonly ListedCommentDraft[];
  headOid: string;
}) {
  const headingId = useId();
  const first = drafts[0];
  if (first === undefined) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 border-b border-border px-3 py-2"
    >
      <h2
        id={headingId}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        <Icon name="Clock" className="size-3.5" />
        Drafts on an older commit
      </h2>
      <p className="flex items-start gap-1.5 text-xs text-warning-text">
        <Icon name="AlertTriangle" className="mt-px size-3.5 shrink-0 text-warning" />
        {newCommitsText(first.commitOid, headOid)}
      </p>
      <p className="text-xs text-muted-foreground">
        Submit or delete these drafts to add new comments.
      </p>
      <div className="-mx-2 flex flex-col">
        {drafts.map((draft) => (
          <CommentDraftCard key={draft.id} draft={draft} showLocation />
        ))}
      </div>
    </section>
  );
}
