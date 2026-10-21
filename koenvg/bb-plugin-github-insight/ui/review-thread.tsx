import { useId, useState, type ReactNode } from "react";
import { Markdown, UrlLink } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { relativeTime } from "../core/relative-time";
import type { ReviewComment, ReviewThread } from "../core/review-threads";
import { JUMPED_RING, PRIMARY_BUTTON, QUIET_BUTTON, SECONDARY_BUTTON, TEXTAREA } from "./controls";
import { useJumpHighlight } from "./jump-highlight";
import { useNewComment, useThreadHasNewComment } from "./new-comment-glow";
import "./new-comment.css";
import { useThreadActions } from "./thread-actions";
import { useThreadSelection } from "./thread-selection";

export function ReviewThreadCard({ thread }: { thread: ReviewThread }) {
  const selection = useThreadSelection();
  const hasNewComment = useThreadHasNewComment(thread);
  const [toggled, setToggled] = useState<boolean | null>(null);
  const expanded = toggled ?? hasNewComment;
  const selected = !thread.resolved && selection.isSelected(thread.id);
  const open = !thread.resolved || expanded;
  const jumped = useJumpHighlight("thread", thread.id);
  return (
    <article
      data-review-thread-id={thread.id}
      data-jumped={jumped || undefined}
      className={cn(
        "mx-2 my-2 flex flex-col overflow-hidden rounded-lg border bg-background font-sans text-sm shadow-[0_1px_2px_rgb(0_0_0/0.04),0_2px_8px_-2px_rgb(0_0_0/0.06)] transition-[border-color,box-shadow] duration-200 motion-reduce:transition-none",
        selected ? "border-primary/50 ring-1 ring-primary/25" : "border-border",
        JUMPED_RING,
      )}
    >
      {thread.resolved && (
        <ResolvedSummary thread={thread} expanded={expanded} toggle={() => setToggled(!expanded)} />
      )}
      {open && (
        <>
          <div className="flex flex-col divide-y divide-border/70">
            {thread.comments.map((comment, index) => (
              <CommentView
                key={comment.id}
                comment={comment}
                trailing={
                  index === 0 && !thread.resolved ? (
                    <AgentToggle reviewThreadId={thread.id} />
                  ) : null
                }
              />
            ))}
          </div>
          {thread.hasMoreComments && <MoreCommentsLink thread={thread} />}
          <ThreadActionsView thread={thread} />
        </>
      )}
    </article>
  );
}

function ResolvedSummary({
  thread,
  expanded,
  toggle,
}: {
  thread: ReviewThread;
  expanded: boolean;
  toggle: () => void;
}) {
  const first = thread.comments[0];
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className={cn(
        "flex min-w-0 items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none",
        expanded && "border-b border-border/70",
      )}
      onClick={toggle}
    >
      <Icon name="CircleCheck" className="size-3.5 shrink-0" />
      <span className="shrink-0 font-medium text-foreground">{first?.author}</span>
      <span className="shrink-0">Resolved</span>
      {!expanded && first !== undefined && (
        <span className="min-w-0 truncate opacity-80">{firstLine(first.body)}</span>
      )}
      <Icon
        name={expanded ? "ChevronDown" : "ChevronRight"}
        className="ml-auto size-3.5 shrink-0"
      />
    </button>
  );
}

function AgentToggle({ reviewThreadId }: { reviewThreadId: string }) {
  const selection = useThreadSelection();
  const selected = selection.isSelected(reviewThreadId);
  return (
    <label
      className={cn(
        "inline-flex h-6 cursor-pointer select-none items-center gap-1 rounded-full border px-2 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        selected
          ? "border-primary bg-primary text-primary-foreground hover:bg-primary/90"
          : "border-border text-muted-foreground hover:border-foreground/20 hover:bg-muted hover:text-foreground",
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={selected}
        onChange={() => selection.toggle(reviewThreadId)}
      />
      <Icon name={selected ? "Check" : "Bot"} className="size-3.5" />
      Add to agent
    </label>
  );
}

function CommentView({ comment, trailing }: { comment: ReviewComment; trailing: ReactNode }) {
  const createdAt = new Date(comment.createdAt);
  const { ref, glowing } = useNewComment(comment.id);
  return (
    <div
      ref={ref}
      data-review-comment-id={comment.id}
      className={cn("flex flex-col gap-1.5 px-3 pb-2.5 pt-2", glowing && "review-comment-new")}
    >
      <div className="flex min-h-6 items-center gap-2 text-xs">
        <Avatar login={comment.author} url={comment.avatarUrl} />
        <span className="truncate font-semibold text-foreground">{comment.author}</span>
        <UrlLink
          href={comment.url}
          className="shrink-0 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <time
            dateTime={createdAt.toISOString()}
            title={createdAt.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          >
            {relativeTime(createdAt, new Date())}
          </time>
        </UrlLink>
        {trailing !== null && <div className="ml-auto shrink-0">{trailing}</div>}
      </div>
      <div className="pl-7 leading-relaxed [&_pre]:overflow-x-auto">
        <Markdown content={comment.body} />
      </div>
    </div>
  );
}

function Avatar({ login, url }: { login: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  if (url === null || failed) {
    return (
      <span
        aria-hidden
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground"
      >
        {login.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="size-5 shrink-0 rounded-full bg-muted ring-1 ring-border"
      onError={() => setFailed(true)}
    />
  );
}

function MoreCommentsLink({ thread }: { thread: ReviewThread }) {
  const url = thread.comments.at(-1)?.url;
  if (url === undefined) return null;
  return (
    <UrlLink
      href={url}
      className="flex items-center gap-1 border-t border-border/70 px-3 py-1.5 pl-10 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
    >
      More comments on GitHub
      <Icon name="ArrowUpRight" className="size-3" />
    </UrlLink>
  );
}

function ThreadActionsView({ thread }: { thread: ReviewThread }) {
  const actions = useThreadActions();
  const headingId = useId();
  const { replyText, hasDraft, busy, error, pendingReviewUrl } = actions.stateOf(thread.id);
  const canPost = !busy && replyText.trim() !== "";
  return (
    <section
      aria-labelledby={hasDraft ? headingId : undefined}
      className={cn(
        "flex flex-col gap-2 border-t border-border/70 px-3 py-2.5",
        hasDraft ? "bg-primary/[0.04]" : "bg-muted/30",
      )}
    >
      {hasDraft && (
        <h3 id={headingId} className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <Icon name="Bot" className="size-3.5" />
          Draft from agent
        </h3>
      )}
      {!thread.resolved && (
        <textarea
          aria-label="Reply"
          placeholder="Reply…"
          rows={2}
          className={cn(TEXTAREA, hasDraft ? "border-primary/30" : "border-border")}
          value={replyText}
          disabled={busy}
          onChange={(event) => actions.setReplyText(thread.id, event.target.value)}
        />
      )}
      {error !== null && (
        <p role="alert" className="flex items-start gap-1.5 break-words text-xs text-destructive">
          <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
      {pendingReviewUrl !== null && (
        <p role="status" className="text-xs text-muted-foreground">
          Reply added to your pending review.{" "}
          <UrlLink
            href={pendingReviewUrl}
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            Open the PR
          </UrlLink>
        </p>
      )}
      <div className="flex items-center gap-1.5">
        {thread.resolved ? (
          <button
            type="button"
            className={QUIET_BUTTON}
            disabled={busy}
            onClick={() => void actions.setResolved(thread.id, false)}
          >
            Unresolve
          </button>
        ) : (
          <>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={!canPost}
              onClick={() => void actions.post(thread.id, { resolve: false })}
            >
              Post
            </button>
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={!canPost}
              onClick={() => void actions.post(thread.id, { resolve: true })}
            >
              Post + resolve
            </button>
            {hasDraft && (
              <button
                type="button"
                className={QUIET_BUTTON}
                disabled={busy}
                onClick={() => void actions.discardDraft(thread.id)}
              >
                Discard
              </button>
            )}
            <button
              type="button"
              className={cn(QUIET_BUTTON, "ml-auto")}
              disabled={busy}
              onClick={() => void actions.setResolved(thread.id, true)}
            >
              <Icon name="Check" className="size-3.5" />
              Resolve
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function firstLine(body: string): string {
  return body.trimStart().split("\n", 1)[0] ?? "";
}
