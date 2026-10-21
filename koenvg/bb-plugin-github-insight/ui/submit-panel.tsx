import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, SubmitReviewResult } from "../contract";
import type { PrHead } from "../core/pr-head";
import { hasText, type ListedCommentDraft, type SummaryDraft } from "../core/review-drafts";
import { submitRules, type ReviewEvent } from "../core/review-submit";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useCommentDrafts } from "./comment-drafts";
import { PRIMARY_BUTTON, TEXTAREA } from "./controls";
import { useDraftSaves } from "./draft-saves";
import { messageOf } from "./error-message";
import { announceSummaryWritten } from "./summary-written";

const VERDICT_LABELS: Record<ReviewEvent, string> = {
  COMMENT: "Comment",
  APPROVE: "Approve",
  REQUEST_CHANGES: "Request changes",
};

const SUMMARY_KEY = "summary";

export function SubmitReviewToggle({ open, toggle }: { open: boolean; toggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        open && "bg-muted",
      )}
      onClick={toggle}
    >
      <Icon
        name="ChevronRight"
        className={cn(
          "size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none",
          open && "rotate-90",
        )}
      />
      Submit review
    </button>
  );
}

interface SubmitPanelProps {
  threadId: string;
  open: boolean;
  head: PrHead;
  commentDrafts: readonly ListedCommentDraft[];
  summaryDraft: SummaryDraft | null;
  onWritten: () => void;
}

export function SubmitPanel({
  threadId,
  open,
  head,
  commentDrafts,
  summaryDraft,
  onWritten,
}: SubmitPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const headingId = useId();
  const reasonId = useId();
  const drafts = useCommentDrafts();
  const commentCount = commentDrafts.filter((draft) => hasText(drafts.stateOf(draft).text)).length;
  const summary = useSummaryText(threadId, summaryDraft);
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SubmitReviewResult | null>(null);
  const [submittedAt, setSubmittedAt] = useState<number | null>(null);
  useEffect(() => {
    if (submittedAt === null) return;
    const timer = setTimeout(() => setSubmittedAt(null), SUBMITTED_LABEL_MS);
    return () => clearTimeout(timer);
  }, [submittedAt]);

  const rules = submitRules({
    viewerIsAuthor: head.viewerIsAuthor,
    state: head.state,
    body: summary.text,
    commentCount,
  });
  const selected = rules.find((rule) => rule.event === event) ?? rules[0]!;

  async function submit() {
    setBusy(true);
    setOutcome(null);
    await summary.flush();
    await drafts.flushAll();
    const result = await rpc
      .call("submitReview", { threadId, event: selected.event, body: summary.text })
      .catch((error: unknown) => ({
        kind: "error" as const,
        message: messageOf(error),
        url: null,
      }));
    if (result.kind === "submitted") {
      summary.clear();
      onWritten();
      announceSummaryWritten(threadId);
      setSubmittedAt(Date.now());
    }
    setOutcome(result);
    setBusy(false);
  }

  return (
    <div
      aria-hidden={!open}
      inert={!open}
      className={cn(
        "grid shrink-0 transition-[grid-template-rows,opacity] motion-reduce:transition-none",
        open
          ? "grid-rows-[1fr] opacity-100 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          : "grid-rows-[0fr] opacity-0 duration-150 ease-in",
      )}
    >
      <section aria-labelledby={headingId} className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-2 border-b border-border bg-muted/30 px-3 py-2.5 text-sm">
          <div className="flex items-center gap-2 text-xs">
            <h2 id={headingId} className="font-medium">
              Submit review
            </h2>
            {summary.fromAgent && (
              <span className="flex items-center gap-1 text-primary">
                <Icon name="Bot" className="size-3.5" />
                Summary from agent
              </span>
            )}
            <span className="ml-auto text-muted-foreground tabular-nums">
              {commentsText(commentCount)}
            </span>
          </div>
          <textarea
            aria-label="Summary"
            placeholder="Leave a summary…"
            rows={2}
            className={cn(TEXTAREA, "border-border")}
            value={summary.text}
            disabled={busy}
            onChange={(change) => summary.setText(change.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="radiogroup"
              aria-label="Verdict"
              className="flex flex-wrap items-center gap-1.5"
            >
              {rules.map((rule) => (
                <VerdictOption
                  key={rule.event}
                  event={rule.event}
                  checked={rule.event === selected.event}
                  disabled={busy}
                  select={() => setEvent(rule.event)}
                />
              ))}
            </div>
            <button
              type="button"
              className={cn(PRIMARY_BUTTON, "ml-auto")}
              aria-describedby={selected.disabledReason === null ? undefined : reasonId}
              disabled={busy || selected.disabledReason !== null}
              onClick={() => void submit()}
            >
              <SubmitLabel busy={busy} submittedAt={submittedAt} />
            </button>
          </div>
          {selected.disabledReason !== null && (
            <p id={reasonId} className="text-xs text-muted-foreground">
              {selected.disabledReason}
            </p>
          )}
          {summary.saveError !== null && <ErrorText>{summary.saveError}</ErrorText>}
          {outcome?.kind === "error" && (
            <ErrorText>
              {outcome.message}
              {outcome.url !== null && (
                <>
                  {" "}
                  <UrlLink
                    href={outcome.url}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    Open the PR
                  </UrlLink>
                </>
              )}
            </ErrorText>
          )}
          {outcome?.kind === "submitted" && (
            <p
              role="status"
              className="flex items-center gap-1.5 text-xs text-muted-foreground duration-300 ease-out animate-in fade-in slide-in-from-top-1 motion-reduce:slide-in-from-top-0"
            >
              <Icon name="CircleCheck" className="size-3.5 text-success" />
              Review submitted
            </p>
          )}
          {outcome?.kind === "submitted" && outcome.markError !== undefined && (
            <ErrorText>
              Could not mark the PR reviewed: {outcome.markError}. Use "Mark reviewed" in the Pull
              Requests panel.
            </ErrorText>
          )}
        </div>
      </section>
    </div>
  );
}

const SUBMITTED_LABEL_MS = 1800;

function SubmitLabel({ busy, submittedAt }: { busy: boolean; submittedAt: number | null }) {
  if (busy) {
    return (
      <>
        <Icon name="Loading" className="size-3.5 animate-spin motion-reduce:animate-none" />
        Submitting…
      </>
    );
  }
  if (submittedAt !== null) {
    return (
      <span
        key={submittedAt}
        className="inline-flex items-center gap-1 duration-200 animate-in fade-in"
      >
        <Icon
          name="Check"
          className="size-3.5 duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in zoom-in-50 spin-in-[-90deg] motion-reduce:animate-none"
        />
        Submitted
      </span>
    );
  }
  return <>Submit</>;
}

function VerdictOption({
  event,
  checked,
  disabled,
  select,
}: {
  event: ReviewEvent;
  checked: boolean;
  disabled: boolean;
  select: () => void;
}) {
  return (
    <label
      className={cn(
        "inline-flex h-7 cursor-pointer select-none items-center rounded-full border px-2.5 text-xs font-medium transition-colors has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
        checked
          ? "border-foreground/30 bg-background text-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <input
        type="radio"
        name="verdict"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={select}
      />
      {VERDICT_LABELS[event]}
    </label>
  );
}

function useSummaryText(threadId: string, summaryDraft: SummaryDraft | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [typedText, setTypedText] = useState<string | null>(null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveSummaryDraft = useCallback(
    (_key: string, body: string) => rpc.call("saveSummaryDraft", { threadId, body }),
    [rpc, threadId],
  );
  const reportSaveError = useCallback((_key: string, message: string) => setSaveError(message), []);
  const saves = useDraftSaves(saveSummaryDraft, reportSaveError);

  const draft = summaryDraft?.updatedAt === dismissedAt ? null : summaryDraft;
  return {
    text: typedText ?? draft?.body ?? "",
    fromAgent: typedText === null && draft?.source === "agent",
    saveError,
    setText(text: string) {
      setSaveError(null);
      setTypedText(text);
      saves.schedule(SUMMARY_KEY, text);
    },
    flush: () => saves.flush(SUMMARY_KEY),
    clear() {
      setTypedText(null);
      setDismissedAt(summaryDraft?.updatedAt ?? null);
    },
  };
}

function ErrorText({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-1.5 break-words text-xs text-destructive">
      <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function commentsText(count: number): string {
  return count === 1 ? "1 comment" : `${count} comments`;
}
