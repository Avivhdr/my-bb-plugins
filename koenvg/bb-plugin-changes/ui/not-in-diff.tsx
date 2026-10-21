import { InlineCommentForm } from "../../review-ui/inline-comment-form";
import { PendingCommentCard } from "../../review-ui/pending-comment-card";
import {
  anchorKey,
  pendingReviews,
  type CommentAnchor,
  type OpenForm,
  type PendingComment,
} from "../core/pending-review";
import { sortComments } from "../core/review-prompt";

interface NotInDiffProps {
  threadId: string;
  comments: readonly PendingComment[];
  forms: readonly OpenForm[];
}

export function NotInDiff({ threadId, comments, forms }: NotInDiffProps) {
  if (comments.length === 0 && forms.length === 0) return null;
  return (
    <section aria-label="Not in this diff" className="border-b border-border py-1">
      <h2 className="px-3 pt-1.5 text-xs font-medium text-muted-foreground">Not in this diff</h2>
      {sortComments(comments).map((comment) => (
        <PendingCommentCard
          key={comment.id}
          body={comment.body}
          onRemove={() => pendingReviews.removeComments(threadId, [comment.id])}
          location={<Location anchor={comment} />}
        />
      ))}
      {forms.map((form) => (
        <div key={anchorKey(form.anchor)}>
          <div className="px-3 pt-1 text-xs">
            <Location anchor={form.anchor} />
          </div>
          <InlineCommentForm
            text={form.text}
            onTextChange={(text) => pendingReviews.setFormText(threadId, form.anchor, text)}
            onSubmit={() => pendingReviews.addComment(threadId, form.anchor, form.text.trim())}
            onCancel={() => pendingReviews.closeForm(threadId, form.anchor)}
          />
        </div>
      ))}
    </section>
  );
}

function Location({ anchor }: { anchor: CommentAnchor }) {
  return (
    <span className="min-w-0 truncate font-mono text-muted-foreground" title={anchor.path}>
      {anchor.path}:{anchor.line}
      {anchor.side === "deletions" ? " (deleted line)" : ""}
    </span>
  );
}
