import { canMark } from "../core/viewed-files";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { diffLines } from "../../review-ui/diff-lines";
import { DiffStat } from "../../review-ui/diff-stat";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../../review-ui/styles";
import type { DiffView } from "../../review-ui/review-file-diff";
import type { rpcContract } from "../contract";
import { targetKey, type BranchCommit, type ChangedFile, type DiffTarget } from "../core/changes";
import { pendingReviews, type OpenForm, type PendingComment } from "../core/pending-review";
import { placeByAnchor, type FileLines } from "../core/place-comments";
import { buildReviewPrompt, sortComments } from "../core/review-prompt";
import { messageOf } from "../core/changes";
import { compareFilePaths } from "../core/file-order";
import { FileOutline } from "./file-outline";
import { FileSection } from "./file-section";
import { NotInDiff } from "./not-in-diff";
import { SendFeedbackDialog } from "./send-feedback-dialog";
import { useChanges } from "./use-changes";
import { useFileNavigation } from "./use-file-navigation";
import { usePatches, type LoadedChanges, type PatchState, type Patches } from "./use-patches";
import { usePendingReview } from "./use-pending-review";
import { useViewed, type Viewed } from "./use-viewed";

export function ChangesTab({ threadId }: { threadId: string }) {
  return <ChangesTabContent key={threadId} threadId={threadId} />;
}

const ALL_CHANGES: DiffTarget = { kind: "all" };

function ChangesTabContent({ threadId }: { threadId: string }) {
  const [target, setTarget] = useState<DiffTarget>(ALL_CHANGES);
  const [view, setView] = useState<DiffView>("unified");
  const { result, loading, generation, refresh } = useChanges(threadId, target);
  const review = usePendingReview(threadId);
  const feedback = useSendFeedback(threadId);
  const loaded = result?.kind === "ok" ? result : null;
  const sorted = useMemo(
    () => loaded && { ...loaded, files: [...loaded.files].sort(byPath) },
    [loaded],
  );
  const patches = usePatches(threadId, sorted);
  const viewed = useViewed(threadId, sorted, patches);
  const files = sorted?.files ?? NO_FILES;
  const commentCounts = useMemo(() => countByPath(review.comments), [review.comments]);
  const paths = useMemo(() => files.map((file) => file.path), [files]);
  const scrollArea = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const navigation = useFileNavigation(scrollArea, content, paths);

  return (
    <div className="@container flex h-full flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <TargetPicker target={target} commits={loaded?.commits ?? []} onChange={setTarget} />
          {loaded !== null && <DiffSummary files={files} viewed={viewed.counts} />}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          {viewed.error !== null && (
            <span role="alert" className="mr-1.5 text-xs text-destructive">
              {viewed.error}
            </span>
          )}
          {feedback.status !== null && (
            <span role="status" className="mr-1.5 text-xs text-muted-foreground">
              {feedback.status}
            </span>
          )}
          <ViewToggle view={view} onChange={setView} />
          <button
            type="button"
            aria-label={loading ? "Refreshing…" : "Refresh"}
            title="Refresh"
            className={ICON_BUTTON}
            disabled={loading}
            onClick={refresh}
          >
            <Icon
              name="ArrowReloadHorizontal"
              className={cn("size-4", loading && "animate-spin motion-reduce:animate-none")}
            />
          </button>
          <button
            type="button"
            className={cn(PRIMARY_BUTTON, "ml-1.5")}
            disabled={review.comments.length === 0}
            onClick={() => feedback.open(review.comments)}
          >
            Send feedback ({review.comments.length})
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        {files.length > 0 && (
          <FileOutline
            key={targetKey(target)}
            files={files}
            commentCounts={commentCounts}
            current={navigation.current}
            onSelect={navigation.jumpTo}
          />
        )}
        <div ref={scrollArea} data-diff-scroll-area className="min-h-0 flex-1 overflow-y-auto">
          <div ref={content}>
            {result === null ? (
              <Notice>Loading changes…</Notice>
            ) : result.kind === "no_git" ? (
              <Notice>No git repository for this thread</Notice>
            ) : result.kind === "error" ? (
              <LoadError message={result.message} retry={refresh} busy={loading} />
            ) : (
              <FileList
                threadId={threadId}
                changes={sorted ?? result}
                imageGeneration={generation}
                imagesActive={
                  !loading &&
                  (!loaded?.imageBasis ||
                    JSON.stringify(loaded.imageBasis.target) === JSON.stringify(target))
                }
                patches={patches}
                viewed={viewed}
                comments={review.comments}
                openForms={review.openForms}
                view={view}
              />
            )}
          </div>
        </div>
      </div>
      {feedback.dialog !== null && (
        <SendFeedbackDialog
          initialPrompt={feedback.dialog.prompt}
          sending={feedback.dialog.sending}
          error={feedback.dialog.error}
          onSend={feedback.send}
          onClose={feedback.close}
        />
      )}
    </div>
  );
}

interface FileListProps {
  threadId: string;
  changes: LoadedChanges;
  imagesActive: boolean;
  imageGeneration: number;
  patches: Patches;
  viewed: Viewed;
  comments: readonly PendingComment[];
  openForms: ReadonlyMap<string, OpenForm>;
  view: DiffView;
}

function FileList({
  threadId,
  changes,
  imagesActive,
  imageGeneration,
  patches,
  viewed,
  comments,
  openForms,
  view,
}: FileListProps) {
  const linesByPath = useMemo(
    () =>
      new Map(
        changes.files.map((file) => [file.path, fileLines(file, patches.stateOf(file.path))]),
      ),
    [changes.files, patches],
  );
  const linesOf = useCallback(
    (path: string): FileLines => linesByPath.get(path) ?? "absent",
    [linesByPath],
  );
  const placedComments = useMemo(
    () => placeByAnchor(comments, (comment) => comment, linesOf),
    [comments, linesOf],
  );
  const placedForms = useMemo(
    () => placeByAnchor(openForms.values(), (form) => form.anchor, linesOf),
    [openForms, linesOf],
  );

  useEffect(() => {
    for (const comment of comments) if (linesByPath.has(comment.path)) patches.load(comment.path);
    for (const { anchor } of openForms.values())
      if (linesByPath.has(anchor.path)) patches.load(anchor.path);
  }, [comments, openForms, linesByPath, patches]);

  if (
    changes.files.length === 0 &&
    placedComments.notInDiff.length === 0 &&
    placedForms.notInDiff.length === 0
  ) {
    return <Notice>No changes</Notice>;
  }
  return (
    <>
      <NotInDiff
        threadId={threadId}
        comments={placedComments.notInDiff}
        forms={placedForms.notInDiff}
      />
      {changes.files.map((file) => {
        const lines = linesByPath.get(file.path);
        return (
          <FileSection
            key={file.path}
            threadId={threadId}
            environmentId={changes.environmentId}
            imageBasis={changes.imageBasis}
            imagesActive={imagesActive}
            imageGeneration={imageGeneration}
            contextCurrent={patches.currentPatch(file.path) !== null}
            file={file}
            patch={patches.stateOf(file.path)}
            lines={lines === undefined || typeof lines === "string" ? null : lines}
            loadPatch={patches.load}
            comments={placedComments.byPath.get(file.path) ?? NONE}
            openForms={placedForms.byPath.get(file.path) ?? NO_FORMS}
            view={view}
            viewed={viewed.of(file.path)}
          />
        );
      })}
    </>
  );
}

const NONE: readonly PendingComment[] = [];
const NO_FORMS: readonly OpenForm[] = [];
const NO_FILES: readonly ChangedFile[] = [];

function countByPath(comments: readonly PendingComment[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { path } of comments) counts.set(path, (counts.get(path) ?? 0) + 1);
  return counts;
}

function byPath(a: ChangedFile, b: ChangedFile): number {
  return compareFilePaths(a.path, b.path);
}

function fileLines(file: ChangedFile, state: PatchState): FileLines {
  if (!canMark(file)) return "absent";
  if (state.kind === "loaded") return diffLines(state.patch);
  return state.kind === "loading" ? "pending" : "absent";
}

interface FeedbackDialog {
  comments: readonly PendingComment[];
  prompt: string;
  sending: boolean;
  error: string | null;
}

function useSendFeedback(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [dialog, setDialog] = useState<FeedbackDialog | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  function open(comments: readonly PendingComment[]) {
    const snapshot = sortComments(comments);
    setStatus(null);
    setDialog({
      comments: snapshot,
      prompt: buildReviewPrompt(snapshot),
      sending: false,
      error: null,
    });
  }

  async function send(text: string) {
    if (dialog === null) return;
    const { comments } = dialog;
    setDialog({ ...dialog, sending: true, error: null });
    const result = await rpc
      .call("sendFeedback", { threadId, text })
      .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
    if (result.kind === "error") {
      setDialog((current) => current && { ...current, sending: false, error: result.message });
      return;
    }
    pendingReviews.removeComments(
      threadId,
      comments.map((comment) => comment.id),
    );
    setDialog(null);
    setStatus(result.delivery === "queued" ? "Queued until the agent is idle" : "Sent to agent");
  }

  return {
    dialog,
    status,
    open,
    send: (text: string) => void send(text),
    close: () => setDialog(null),
  };
}

const STATIC_TARGETS = [
  { value: "all", label: "All changes" },
  { value: "uncommitted", label: "Uncommitted" },
  { value: "branch_committed", label: "Committed on branch" },
] as const;

function parseTarget(value: string): DiffTarget {
  if (value.startsWith("commit:")) return { kind: "commit", sha: value.slice("commit:".length) };
  if (value === "uncommitted") return { kind: "uncommitted" };
  if (value === "branch_committed") return { kind: "branch_committed" };
  return ALL_CHANGES;
}

function TargetPicker({
  target,
  commits,
  onChange,
}: {
  target: DiffTarget;
  commits: readonly BranchCommit[];
  onChange: (target: DiffTarget) => void;
}) {
  const selectedCommitMissing =
    target.kind === "commit" && !commits.some((commit) => commit.sha === target.sha);
  return (
    <select
      aria-label="Diff target"
      className="h-7 rounded-md border border-border bg-background px-2 text-xs"
      value={targetKey(target)}
      onChange={(event) => onChange(parseTarget(event.target.value))}
    >
      {STATIC_TARGETS.map(({ value, label }) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
      {selectedCommitMissing && <option value={targetKey(target)}>{target.sha.slice(0, 7)}</option>}
      {commits.map((commit) => (
        <option key={commit.sha} value={`commit:${commit.sha}`}>
          {commit.shortSha} {commit.subject}
        </option>
      ))}
    </select>
  );
}

const ICON_BUTTON =
  "inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

const VIEWS = [
  { view: "unified", label: "Unified view", icon: "ListView" },
  { view: "split", label: "Split view", icon: "Columns2" },
] as const;

function ViewToggle({ view, onChange }: { view: DiffView; onChange: (view: DiffView) => void }) {
  return (
    <div
      role="group"
      aria-label="Diff view"
      className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {VIEWS.map((option) => (
        <button
          key={option.view}
          type="button"
          aria-label={option.label}
          title={option.label}
          aria-pressed={view === option.view}
          className={cn(
            "inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            view === option.view && "bg-muted text-foreground",
          )}
          onClick={() => onChange(option.view)}
        >
          <Icon name={option.icon} className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function DiffSummary({
  files,
  viewed,
}: {
  files: readonly ChangedFile[];
  viewed: { viewed: number; markable: number } | null;
}) {
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  return (
    <span
      data-testid="diff-summary"
      className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums"
    >
      {files.length} {files.length === 1 ? "file" : "files"}
      <DiffStat additions={additions} deletions={deletions} />
      {viewed !== null && viewed.markable > 0 && (
        <span>
          {viewed.viewed}/{viewed.markable} viewed
        </span>
      )}
    </span>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="m-3 rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function LoadError({
  message,
  retry,
  busy,
}: {
  message: string;
  retry: () => void;
  busy: boolean;
}) {
  return (
    <div
      role="alert"
      className="m-3 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <span className="min-w-0 break-words text-destructive">{message}</span>
      <button
        type="button"
        className={cn(SECONDARY_BUTTON, "ml-auto")}
        onClick={retry}
        disabled={busy}
      >
        Retry
      </button>
    </div>
  );
}
