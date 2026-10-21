import type { PrImageBasis } from "../core/pr-image-basis";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, SendToAgentResult } from "../contract";
import { commentStops } from "../core/comment-stops";
import { splitByCommit } from "../core/draft-commits";
import type { ReviewFile } from "../core/pr-files";
import type { PrHead } from "../core/pr-head";
import type { ListedCommentDraft, SummaryDraft } from "../core/review-drafts";
import {
  isReviewUpdateFor,
  REVIEW_DRAFTS_UPDATED_CHANNEL,
  REVIEW_UPDATED_CHANNEL,
} from "../core/review-updated";
import type { ViewedMarks } from "../core/viewed-marks";
import {
  commentHolders,
  openThreadCounts,
  openThreads,
  threadsWithComments,
  visibleThreads,
  type PlacedThread,
  type ThreadPlacement,
} from "../core/thread-placement";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { useCommandIntent } from "./command-intents";
import { CommentDraftsProvider, useNewComments } from "./comment-drafts";
import { Notice, RefreshButton, RefreshError, SendToAgentButton } from "./feedback";
import { PrFileDiff } from "./file-diff";
import type { FilesJumpRequest } from "./files-jump";
import { IconTooltip } from "./icon-tooltip";
import { JumpMarkContext } from "./jump-highlight";
import { NewCommentGlowContext, useNewCommentGlowState } from "./new-comment-glow";
import { OlderCommentDrafts } from "./older-comment-drafts";
import { OutdatedThreads } from "./outdated-threads";
import { SubmitPanel, SubmitReviewToggle } from "./submit-panel";
import { ThreadActionsProvider } from "./thread-actions";
import { ThreadSelectionContext, useThreadSelectionState } from "./thread-selection";
import {
  useCommentNavigation,
  type CommentNavigation,
  type StepDirection,
} from "./use-comment-navigation";
import { usePrViewed } from "./use-pr-viewed";
import { useThreadResult } from "./use-thread-result";
import { ViewerReviewBadge } from "./viewer-review-badge";

function useReview(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const fetchReview = useCallback((id: string) => rpc.call("getReview", { threadId: id }), [rpc]);
  const state = useThreadResult(threadId, fetchReview);
  const { reload, patch } = state;
  const latestDraftsRequest = useRef(0);

  const reloadDrafts = useCallback(() => {
    const request = ++latestDraftsRequest.current;
    void rpc.call("getDrafts", { threadId }).then(
      (drafts) => {
        if (request !== latestDraftsRequest.current) return;
        if (drafts.kind !== "ok") reload();
        else patch((result) => (result.kind === "ok" ? { ...result, ...drafts } : result));
      },
      () => {
        if (request === latestDraftsRequest.current) reload();
      },
    );
  }, [rpc, threadId, reload, patch]);

  const removeCommentDraft = useCallback(
    (draftId: string) =>
      patch((result) =>
        result.kind === "ok"
          ? { ...result, commentDrafts: result.commentDrafts.filter(({ id }) => id !== draftId) }
          : result,
      ),
    [patch],
  );

  useRealtime(REVIEW_UPDATED_CHANNEL, (payload) => {
    if (isReviewUpdateFor(payload, threadId)) reload();
  });
  useRealtime(REVIEW_DRAFTS_UPDATED_CHANNEL, (payload) => {
    if (isReviewUpdateFor(payload, threadId)) reloadDrafts();
  });

  return { ...state, reloadDrafts, removeCommentDraft };
}

interface SubmitRequest {
  onHandled: () => void;
}

interface CommentStepRequest {
  direction: StepDirection;
  onHandled: () => void;
}

interface ReviewCommandRequests {
  submit: SubmitRequest | undefined;
  commentStep: CommentStepRequest | undefined;
}

const STEP_OF_INTENT = { "next-comment": 1, "previous-comment": -1 } as const;

function useReviewCommands(
  threadId: string,
  result: ReturnType<typeof useReview>["result"],
): ReviewCommandRequests {
  const [submitRequested, setSubmitRequested] = useState(false);
  const [stepRequested, setStepRequested] = useState<StepDirection | null>(null);
  useCommandIntent(threadId, "files", (intent) => {
    if (intent === "submit") setSubmitRequested(true);
    else setStepRequested(STEP_OF_INTENT[intent]);
  });

  const loadedWithoutReview = result !== null && result.kind !== "ok";
  useEffect(() => {
    if (!loadedWithoutReview) return;
    setSubmitRequested(false);
    setStepRequested(null);
  }, [loadedWithoutReview, submitRequested, stepRequested]);

  const submit = useMemo<SubmitRequest | undefined>(
    () => (submitRequested ? { onHandled: () => setSubmitRequested(false) } : undefined),
    [submitRequested],
  );
  const commentStep = useMemo<CommentStepRequest | undefined>(
    () =>
      stepRequested === null
        ? undefined
        : { direction: stepRequested, onHandled: () => setStepRequested(null) },
    [stepRequested],
  );
  return { submit, commentStep };
}

interface FilesTabProps {
  threadId: string;
  jump: FilesJumpRequest | null;
}

export function FilesTab({ threadId, jump }: FilesTabProps) {
  return <FilesTabContent key={threadId} threadId={threadId} jump={jump} />;
}

function FilesTabContent({ threadId, jump }: FilesTabProps) {
  const {
    result,
    refreshing,
    revalidating,
    generation,
    refresh,
    reload,
    reloadDrafts,
    removeCommentDraft,
  } = useReview(threadId);
  const requests = useReviewCommands(threadId, result);
  if (result === null)
    return (
      <Padded>
        <Notice>Loading pull request…</Notice>
      </Padded>
    );
  if (result.kind === "no_pr") {
    return (
      <Padded>
        <Notice>No pull request for this thread</Notice>
      </Padded>
    );
  }
  if (result.kind === "error") {
    return (
      <Padded>
        <RefreshError
          message={result.message}
          refreshedAt={null}
          retry={refresh}
          busy={refreshing}
        />
      </Padded>
    );
  }
  return (
    <ThreadActionsProvider
      key={threadId}
      threadId={threadId}
      drafts={result.drafts}
      onWritten={reload}
    >
      <CommentDraftsProvider
        key={threadId}
        threadId={threadId}
        onDeleteStarted={removeCommentDraft}
        onDeleteFailed={reloadDrafts}
      >
        <ReviewContent
          threadId={threadId}
          files={result.files}
          threads={result.threads}
          head={result.head}
          imageBasis={result.imageBasis ?? null}
          imagesActive={!refreshing && !revalidating}
          imageGeneration={generation}
          commentDrafts={result.commentDrafts}
          summaryDraft={result.summaryDraft}
          viewedMarks={result.viewedMarks}
          newCommentIds={result.newCommentIds}
          reload={reload}
          refreshing={refreshing}
          refresh={refresh}
          requests={requests}
          jump={jump}
        />
      </CommentDraftsProvider>
    </ThreadActionsProvider>
  );
}

interface ReviewContentProps {
  threadId: string;
  files: readonly ReviewFile[];
  threads: ThreadPlacement;
  head: PrHead;
  imageBasis: PrImageBasis | null;
  imagesActive: boolean;
  imageGeneration: number;
  commentDrafts: readonly ListedCommentDraft[];
  summaryDraft: SummaryDraft | null;
  viewedMarks: ViewedMarks;
  newCommentIds: readonly string[];
  reload: () => void;
  refreshing: boolean;
  refresh: () => void;
  requests: ReviewCommandRequests;
  jump: FilesJumpRequest | null;
}

function ReviewContent({
  threadId,
  files,
  threads,
  head,
  imageBasis,
  imagesActive,
  imageGeneration,
  commentDrafts,
  summaryDraft,
  viewedMarks,
  newCommentIds,
  reload,
  refreshing,
  refresh,
  requests,
  jump,
}: ReviewContentProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(
    () => commentDrafts.length > 0 || summaryDraft !== null,
  );
  const submitRequest = requests.submit;
  useEffect(() => {
    if (!submitRequest) return;
    setSubmitOpen(true);
    submitRequest.onHandled();
  }, [submitRequest]);
  const openIds = useMemo(() => openThreads(threads).map(({ thread }) => thread.id), [threads]);
  const { selection, selectedIds, deselect } = useThreadSelectionState(openIds);
  const agent = useSendToAgent(threadId, deselect);
  const scrollArea = useRef<HTMLDivElement>(null);
  const glow = useNewCommentGlowState(threadId, newCommentIds, scrollArea);
  const newCommentHolders = useMemo(
    () => commentHolders(threads, glow.glowingIds),
    [threads, glow.glowingIds],
  );
  const visible = useMemo(
    () => visibleThreads(threads, showResolved, newCommentHolders.threadIds),
    [threads, showResolved, newCommentHolders],
  );
  const placedByPath = useMemo(
    () => groupByPath(visible.placed, ({ thread }) => thread.path),
    [visible.placed],
  );
  const counts = useMemo(() => openThreadCounts(threads), [threads]);
  const draftsByCommit = useMemo(
    () => splitByCommit(commentDrafts, head.oid),
    [commentDrafts, head.oid],
  );
  const draftsByPath = useMemo(
    () => groupByPath(draftsByCommit.atHead, (draft) => draft.path),
    [draftsByCommit.atHead],
  );
  const stops = useMemo(
    () =>
      commentStops({
        files,
        threads,
        olderDrafts: draftsByCommit.older,
        drafts: draftsByCommit.atHead,
        showResolved,
        revealedThreadIds: newCommentHolders.threadIds,
      }),
    [files, threads, draftsByCommit, showResolved, newCommentHolders],
  );
  const content = useRef<HTMLDivElement>(null);
  const navigation = useCommentNavigation(scrollArea, content, stops);
  const commentStep = requests.commentStep;
  const step = navigation.step;
  useEffect(() => {
    if (!commentStep) return;
    step(commentStep.direction);
    commentStep.onHandled();
  }, [commentStep, step]);
  const jumpToFirstThread = navigation.jumpToFirstThread;
  useEffect(() => {
    if (jump === null) return;
    const targets = threadsWithComments(threads, jump.commentIds);
    if (!showResolved && targets.length > 0 && targets.every(({ resolved }) => resolved)) {
      setShowResolved(true);
      return;
    }
    jumpToFirstThread(new Set(targets.map(({ id }) => id)));
    jump.onHandled();
  }, [jump, threads, showResolved, jumpToFirstThread]);
  const { create, createError } = useNewComments();
  const viewed = usePrViewed(threadId, files, viewedMarks, newCommentHolders.paths);
  const canAddComment = head.state === "OPEN" && draftsByCommit.older.length === 0;
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-border px-3 py-2 text-xs">
        <span className="mr-1 text-muted-foreground">{filesChangedText(files)}</span>
        {viewed.counts.markable > 0 && (
          <span className="mr-1 text-muted-foreground tabular-nums">
            {viewed.counts.viewed}/{viewed.counts.markable} viewed
          </span>
        )}
        <CountPill emphasis={counts.open > 0}>{counts.open} open</CountPill>
        <CountPill emphasis={false}>{counts.outdated} outdated</CountPill>
        <ViewerReviewBadge review={head.viewerReview} headOid={head.oid} />
        <CommentStepper navigation={navigation} />
        <div className="ml-auto flex items-center gap-2">
          {agent.outcome?.result.kind === "sent" && (
            <span role="status" className="text-muted-foreground">
              {sentText(agent.outcome.result, agent.outcome.requested)}
            </span>
          )}
          <ShowResolvedSwitch checked={showResolved} onChange={setShowResolved} />
          <SubmitReviewToggle open={submitOpen} toggle={() => setSubmitOpen((open) => !open)} />
          {selectedIds.length > 0 && (
            <SendToAgentButton
              count={selectedIds.length}
              sending={agent.sending}
              send={() => agent.send(selectedIds)}
            />
          )}
          <RefreshButton refreshing={refreshing} refresh={refresh} />
        </div>
      </header>
      <SubmitPanel
        threadId={threadId}
        open={submitOpen}
        head={head}
        commentDrafts={commentDrafts}
        summaryDraft={summaryDraft}
        onWritten={reload}
      />
      {createError !== null && <ErrorBanner>{createError}</ErrorBanner>}
      {viewed.error !== null && <ErrorBanner>{viewed.error}</ErrorBanner>}
      {agent.outcome?.result.kind === "error" && (
        <ErrorBanner>{agent.outcome.result.message}</ErrorBanner>
      )}
      <ThreadSelectionContext.Provider value={selection}>
        <NewCommentGlowContext.Provider value={glow}>
          <JumpMarkContext.Provider value={navigation.jumpMark}>
            <div ref={scrollArea} data-diff-scroll-area className="min-h-0 flex-1 overflow-y-auto">
              <div ref={content}>
                <OlderCommentDrafts drafts={draftsByCommit.older} headOid={head.oid} />
                <OutdatedThreads threads={visible.outdated} />
                {files.map((file) => (
                  <PrFileDiff
                    key={file.path}
                    file={file}
                    image={{
                      threadId,
                      basis: imageBasis,
                      active: imagesActive,
                      generation: imageGeneration,
                    }}
                    threads={placedByPath.get(file.path) ?? NO_THREADS}
                    commentDrafts={draftsByPath.get(file.path) ?? NO_COMMENT_DRAFTS}
                    onAddComment={canAddComment ? (...args) => void create(...args) : undefined}
                    viewed={viewed.of(file)}
                  />
                ))}
              </div>
            </div>
          </JumpMarkContext.Provider>
        </NewCommentGlowContext.Provider>
      </ThreadSelectionContext.Provider>
    </div>
  );
}

function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="shrink-0 border-b border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
    >
      {children}
    </div>
  );
}

function useSendToAgent(threadId: string, onSent: (reviewThreadIds: readonly string[]) => void) {
  const rpc = useRpc<typeof rpcContract>();
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<{ result: SendToAgentResult; requested: number } | null>(
    null,
  );

  async function send(reviewThreadIds: readonly string[]) {
    setSending(true);
    setOutcome(null);
    let result: SendToAgentResult;
    try {
      result = await rpc.call("sendToAgent", { threadId, reviewThreadIds: [...reviewThreadIds] });
    } catch (error) {
      result = { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (result.kind === "sent") onSent(reviewThreadIds);
    setOutcome({ result, requested: reviewThreadIds.length });
    setSending(false);
  }

  return { sending, outcome, send };
}

function sentText(result: Extract<SendToAgentResult, { kind: "sent" }>, requested: number): string {
  const count = result.threadCount < requested ? `${result.threadCount} of ${requested} ` : "";
  return result.delivery === "queued"
    ? `Queued ${count}until the agent is idle`
    : `Sent ${count}to agent`;
}

const NO_THREADS: readonly PlacedThread[] = [];
const NO_COMMENT_DRAFTS: readonly ListedCommentDraft[] = [];

function groupByPath<T>(entries: readonly T[], pathOf: (entry: T) => string): Map<string, T[]> {
  const byPath = new Map<string, T[]>();
  for (const entry of entries) {
    const group = byPath.get(pathOf(entry));
    if (group === undefined) byPath.set(pathOf(entry), [entry]);
    else group.push(entry);
  }
  return byPath;
}

function filesChangedText(files: readonly ReviewFile[]): string {
  return files.length === 1 ? "1 file changed" : `${files.length} files changed`;
}

function CountPill({ emphasis, children }: { emphasis: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 tabular-nums",
        emphasis
          ? "bg-foreground/[0.07] font-medium text-foreground"
          : "bg-muted text-muted-foreground",
      )}
    >
      {children}
    </span>
  );
}

function CommentStepper({ navigation }: { navigation: CommentNavigation }) {
  if (navigation.position === null) return null;
  return (
    <div role="group" aria-label="Comment navigation" className="flex items-center gap-0.5">
      <StepButton label="Previous comment" icon="ChevronUp" onClick={() => navigation.step(-1)} />
      <span className="min-w-12 text-center text-muted-foreground tabular-nums">
        {navigation.position + 1} / {navigation.total}
      </span>
      <StepButton label="Next comment" icon="ChevronDown" onClick={() => navigation.step(1)} />
    </div>
  );
}

function StepButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: "ChevronUp" | "ChevronDown";
  onClick: () => void;
}) {
  return (
    <IconTooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onClick}
      >
        <Icon name={icon} className="size-3.5" />
      </button>
    </IconTooltip>
  );
}

function ShowResolvedSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer select-none items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className="relative h-3.5 w-6 shrink-0 rounded-full bg-muted-foreground/25 transition-colors duration-200 after:absolute after:left-0.5 after:top-0.5 after:size-2.5 after:rounded-full after:bg-background after:shadow-[0_1px_2px_rgb(0_0_0/0.2)] after:transition-transform after:duration-200 after:ease-out peer-checked:bg-primary peer-checked:after:translate-x-2.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
      />
      Show resolved
    </label>
  );
}

function Padded({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-y-auto p-3">{children}</div>;
}
