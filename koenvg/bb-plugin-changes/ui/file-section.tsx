import { isVideoPath } from "../core/video-content";
import { ReviewVideoDiff } from "../../review-ui/video-diff";
import { contextEligibility, prepareContextControls, useFileContext } from "./use-file-context";
import type { Snapshot } from "../core/text-context";
import { useCallback } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { ChangesBasis } from "../core/changes";
import { isRasterPath } from "../core/image-content";
import { ReviewImageDiff, imageBlobResult, type ImageSide } from "../../review-ui/image-diff";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import { useBbNavigate, experimental_useCodeTheme as useCodeTheme } from "@get-bb/plugin-sdk/app";
import { diffLines, commentAnchorLine, type DiffLines } from "../../review-ui/diff-lines";
import { DiffStat } from "../../review-ui/diff-stat";
import { InlineCommentForm } from "../../review-ui/inline-comment-form";
import { PendingCommentCard } from "../../review-ui/pending-comment-card";
import { ReviewFileDiff, type DiffView } from "../../review-ui/review-file-diff";
import { CollapseButton, ViewedCheckbox } from "../../review-ui/viewed-controls";
import type { ChangedFile } from "../core/changes";
import { canMark } from "../core/viewed-files";
import { pendingReviews, type OpenForm, type PendingComment } from "../core/pending-review";
import type { PatchState } from "./use-patches";
import type { FileViewedState } from "./use-viewed";

type Annotation = { kind: "comment"; comment: PendingComment } | { kind: "form"; form: OpenForm };
type HeaderControl = "collapse" | "filename" | "viewed";

interface FileSectionProps {
  threadId: string;
  environmentId: string;
  imageBasis?: ChangesBasis | null;
  imagesActive?: boolean;
  imageGeneration?: number;
  contextCurrent?: boolean;
  file: ChangedFile;
  patch: PatchState;
  lines: DiffLines | null;
  loadPatch: (path: string) => void;
  comments: readonly PendingComment[];
  openForms: readonly OpenForm[];
  view: DiffView;
  viewed: FileViewedState;
}

export function FileSection({
  threadId,
  environmentId,
  imageBasis,
  imagesActive = true,
  imageGeneration = 0,
  contextCurrent = false,
  file,
  patch,
  lines,
  loadPatch,
  comments,
  openForms,
  view,
  viewed,
}: FileSectionProps) {
  const { visible, ref } = useNearView<HTMLElement>();
  const showsDiff = canMark(file);
  const openFileButton = <OpenFileButton environmentId={environmentId} file={file} />;
  useEffect(() => {
    if (visible && showsDiff) loadPatch(file.path);
  }, [visible, showsDiff, loadPatch, file.path]);

  return (
    <section
      ref={ref}
      aria-label={file.path}
      data-path={file.path}
      className="min-h-10 border-b border-border"
    >
      {isRasterPath(file.path) ||
      isRasterPath(file.previousPath ?? "") ||
      (file.binary && (isVideoPath(file.path) || isVideoPath(file.previousPath ?? ""))) ? (
        <ChangesPreview
          generation={imageGeneration}
          threadId={threadId}
          file={file}
          basis={imageBasis ?? null}
          active={imagesActive}
          openFileButton={openFileButton}
        />
      ) : !showsDiff ? (
        <FileNotice file={file} openFileButton={openFileButton}>
          {file.binary ? "Binary file" : "Diff too large"}
        </FileNotice>
      ) : (!visible && !viewed.collapsed) || patch.kind === "loading" ? (
        <FileNotice file={file} openFileButton={openFileButton}>
          Loading diff…
        </FileNotice>
      ) : patch.kind === "error" ? (
        <FileNotice file={file} openFileButton={openFileButton}>
          {patch.message}
        </FileNotice>
      ) : (
        <FileDiffWithComments
          threadId={threadId}
          imageBasis={imageBasis}
          imagesActive={imagesActive}
          imageGeneration={imageGeneration}
          contextCurrent={contextCurrent}
          openFileButton={openFileButton}
          file={file}
          patch={patch.patch}
          lines={lines}
          comments={comments}
          openForms={openForms}
          view={view}
          viewed={viewed}
        />
      )}
    </section>
  );
}

function ChangesPreview({
  threadId,
  file,
  basis,
  active,
  generation,
  openFileButton,
}: {
  threadId: string;
  file: ChangedFile;
  basis: ChangesBasis | null;
  active: boolean;
  generation: number;
  openFileButton: ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [collapsed, setCollapsed] = useState(false);
  const video = isVideoPath(file.path) || isVideoPath(file.previousPath ?? "");
  const Preview = video ? ReviewVideoDiff : ReviewImageDiff;
  const load = useCallback(
    async (side: ImageSide, signal: AbortSignal) => {
      if (!basis)
        return {
          kind: "error" as const,
          code: "stale" as const,
          message: "Preview revision unavailable. Refresh changes.",
        };
      const result = await rpc.call(video ? "getVideo" : "getImage", {
        threadId,
        basis,
        file,
        side,
      });
      signal.throwIfAborted();
      return imageBlobResult(result);
    },
    [rpc, threadId, basis, file, video],
  );
  const target = basis?.target;
  const beforeRevision =
    target?.kind === "commit"
      ? `${target.sha} first parent`
      : target?.kind === "uncommitted"
        ? basis?.headSha
        : basis?.mergeBaseRef;
  const afterRevision =
    target?.kind === "all" || target?.kind === "uncommitted"
      ? "Live working tree (at read time)"
      : target?.kind === "commit"
        ? target.sha
        : basis?.headSha;
  return (
    <>
      <div className="flex items-center pl-3">
        <CollapseButton
          path={file.path}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          icons={CHEVRONS}
        />
        <FileHeaderRow file={file} openFileButton={openFileButton} />
      </div>
      {!collapsed && (
        <Preview
          key={JSON.stringify([threadId, basis, generation, file.path, file.previousPath])}
          active={active}
          before={
            ["added", "untracked"].includes(file.status)
              ? null
              : {
                  path: file.previousPath ?? file.path,
                  revision: beforeRevision ?? "Revision unavailable",
                }
          }
          after={
            file.status === "deleted"
              ? null
              : { path: file.path, revision: afterRevision ?? "Revision unavailable" }
          }
          load={load}
        />
      )}
    </>
  );
}

function FileDiffWithComments({
  threadId,
  imageBasis,
  imagesActive,
  imageGeneration = 0,
  contextCurrent,
  file,
  patch,
  lines,
  comments,
  openForms,
  view,
  viewed,
  openFileButton,
}: Omit<FileSectionProps, "patch" | "loadPatch" | "environmentId"> & {
  patch: string;
  openFileButton: ReactNode;
}) {
  const theme = useCodeTheme();
  const fileDiff = useMemo(() => parseFileDiff(patch), [patch]);
  const originalLines = useMemo(() => lines ?? diffLines(patch), [lines, patch]);
  const snapshot = useMemo(
    (): Snapshot | null =>
      imageBasis && imagesActive && contextCurrent && !viewed.collapsed
        ? { threadId, basis: imageBasis, generation: imageGeneration, file, patch }
        : null,
    [
      threadId,
      imageBasis,
      imagesActive,
      contextCurrent,
      viewed.collapsed,
      imageGeneration,
      file,
      patch,
    ],
  );
  const unavailable = useMemo(() => contextEligibility(snapshot, fileDiff), [snapshot, fileDiff]);
  const context = useFileContext(unavailable === null ? snapshot : null);
  const header = useRef<HTMLDivElement>(null);
  const headerFocus = useRef<HeaderControl | null>(null);
  const headerLabels: Record<HeaderControl, string> = {
    collapse: `${viewed.collapsed ? "Expand" : "Collapse"} ${file.path}`,
    filename: `Toggle diff for ${file.path}`,
    viewed: `Viewed ${file.path}`,
  };
  function captureHeaderFocus() {
    const focused = document.activeElement;
    headerFocus.current = null;
    if (!header.current?.contains(focused)) return;
    for (const control of ["collapse", "filename", "viewed"] as const) {
      if (focused?.getAttribute("aria-label") === headerLabels[control])
        headerFocus.current = control;
    }
  }
  useLayoutEffect(() => {
    const control = headerFocus.current;
    headerFocus.current = null;
    if (control === null) return;
    Array.from(header.current?.querySelectorAll<HTMLElement>("[aria-label]") ?? [])
      .find((element) => element.getAttribute("aria-label") === headerLabels[control])
      ?.focus();
  });
  const [commentNotice, setCommentNotice] = useState<string | null>(null);
  useEffect(() => setCommentNotice(null), [patch, imageGeneration, threadId]);
  const contextAction = unavailable === null && context.state.kind !== "ready" && (
    <button
      type="button"
      disabled={
        context.state.kind === "loading" ||
        (context.state.kind === "failed" && context.state.error.code !== "read")
      }
      onClick={context.activate}
      className="shrink-0 cursor-pointer rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {context.state.kind === "loading"
        ? "Loading context…"
        : context.state.kind === "failed" && context.state.error.code === "read"
          ? "Retry context"
          : "Load context"}
    </button>
  );
  const contextNotice =
    context.state.kind === "failed" ? context.state.error.message : unavailable || null;
  const annotations = useMemo(
    (): DiffLineAnnotation<Annotation>[] => [
      ...comments.map((comment) => ({
        side: comment.side,
        lineNumber: comment.line,
        metadata: { kind: "comment" as const, comment },
      })),
      ...openForms.map((form) => ({
        side: form.anchor.side,
        lineNumber: form.anchor.line,
        metadata: { kind: "form" as const, form },
      })),
    ],
    [comments, openForms],
  );
  if (fileDiff === null)
    return (
      <FileNotice file={file} openFileButton={openFileButton}>
        Diff not available
      </FileNotice>
    );
  return (
    <ReviewFileDiff
      key={
        context.state.kind === "ready" ? context.state.diff.cacheKey : `partial-${imageGeneration}`
      }
      fileDiff={context.state.kind === "ready" ? context.state.diff : fileDiff}
      onPostRender={prepareContextControls}
      annotations={annotations}
      view={view}
      theme={theme}
      collapsed={viewed.collapsed}
      customHeader={
        <div ref={header} onClickCapture={captureHeaderFocus} className="w-full">
          <FileHeaderRow
            file={file}
            openFileButton={openFileButton}
            viewed={viewed}
            contextAction={contextAction}
          />
          {contextNotice && (
            <div role="status" className="px-4 pb-2 text-xs text-muted-foreground">
              {contextNotice}
            </div>
          )}
          {commentNotice && (
            <div role="status" className="px-4 pb-2 text-xs text-muted-foreground">
              {commentNotice}
            </div>
          )}
        </div>
      }
      onAddComment={(side, line) => {
        if (!originalLines[side].has(line)) {
          setCommentNotice(
            "Revealed context is read-only. Comment on a line in the original diff.",
          );
          return;
        }
        setCommentNotice(null);
        pendingReviews.openForm(threadId, {
          path: file.path,
          ...commentAnchorLine(originalLines, side, line),
        });
      }}
      renderAnnotation={({ metadata }) =>
        metadata.kind === "comment" ? (
          <PendingCommentCard
            body={metadata.comment.body}
            onRemove={() => pendingReviews.removeComments(threadId, [metadata.comment.id])}
          />
        ) : (
          <InlineCommentForm
            text={metadata.form.text}
            onTextChange={(text) =>
              pendingReviews.setFormText(threadId, metadata.form.anchor, text)
            }
            onSubmit={() =>
              pendingReviews.addComment(threadId, metadata.form.anchor, metadata.form.text.trim())
            }
            onCancel={() => pendingReviews.closeForm(threadId, metadata.form.anchor)}
          />
        )
      }
    />
  );
}

const CHEVRONS = {
  collapsed: <Icon name="ChevronRight" className="size-3.5" />,
  expanded: <Icon name="ChevronDown" className="size-3.5" />,
};

function OpenFileButton({ environmentId, file }: { environmentId: string; file: ChangedFile }) {
  const navigate = useBbNavigate();
  const [error, setError] = useState<string | null>(null);
  const deleted = file.status === "deleted";
  const label = `Open ${file.path} in file viewer`;

  function open() {
    try {
      const accepted = navigate.experimental_openFilePreview({
        target: { kind: "workspace", environmentId, path: file.path },
        location: null,
      });
      setError(accepted ? null : `Could not open ${file.path} in file viewer`);
    } catch {
      setError(`Could not open ${file.path} in file viewer`);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={label}
        title={deleted ? "Deleted files cannot be opened in the live workspace" : label}
        disabled={deleted}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
      >
        <Icon name="ArrowUpRight" aria-hidden="true" className="size-3.5" />
      </button>
      {error !== null && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </>
  );
}

function FileNotice({
  file,
  openFileButton,
  children,
}: {
  file: ChangedFile;
  openFileButton: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col text-sm">
      <FileHeaderRow file={file} openFileButton={openFileButton} />
      <span className="px-4 pb-2 text-xs text-muted-foreground">{children}</span>
    </div>
  );
}

function FileHeaderRow({
  file,
  openFileButton,
  viewed,
  contextAction,
}: {
  file: ChangedFile;
  openFileButton: ReactNode;
  viewed?: FileViewedState;
  contextAction?: ReactNode;
}) {
  const fullPath = file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`;
  const statusLabel = `${file.status.replace("_", " ")} file`;
  const Filename = viewed === undefined ? "span" : "button";
  return (
    <div className="flex min-h-11 w-full min-w-0 items-center gap-2 px-4 text-[13px]">
      {viewed !== undefined && (
        <CollapseButton
          path={file.path}
          collapsed={viewed.collapsed}
          onToggle={viewed.toggleCollapsed}
          icons={CHEVRONS}
        />
      )}
      <span
        role="img"
        aria-label={statusLabel}
        title={statusLabel}
        className="shrink-0 text-muted-foreground"
      >
        <Icon name="File" aria-hidden="true" className="size-3.5" />
      </span>
      <Filename
        type={viewed === undefined ? undefined : "button"}
        aria-label={viewed === undefined ? undefined : `Toggle diff for ${file.path}`}
        aria-expanded={viewed === undefined ? undefined : !viewed.collapsed}
        onClick={viewed?.toggleCollapsed}
        className="flex min-w-0 items-center gap-2 rounded text-left enabled:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        title={fullPath}
      >
        {file.previousPath !== null && (
          <>
            <span dir="rtl" className="min-w-0 truncate text-muted-foreground">
              <bdi>{file.previousPath}</bdi>
            </span>
            <span aria-hidden="true" className="shrink-0">
              {" → "}
            </span>
          </>
        )}
        <span dir="rtl" className="min-w-0 truncate">
          <bdi>{file.path}</bdi>
        </span>
      </Filename>
      {openFileButton}
      {contextAction}
      <span className="ml-auto flex shrink-0 items-center whitespace-nowrap">
        <DiffStat additions={file.additions} deletions={file.deletions} />
        {viewed !== undefined && (
          <ViewedCheckbox
            path={file.path}
            checked={viewed.viewed}
            disabled={!viewed.canToggleViewed}
            onToggle={viewed.toggleViewed}
          />
        )}
      </span>
    </div>
  );
}

function parseFileDiff(patch: string): FileDiffMetadata | null {
  try {
    const files = parsePatchFiles(patch, undefined, true).flatMap((parsed) => parsed.files);
    return files.length === 1 ? files[0]! : null;
  } catch {
    return null;
  }
}

function useNearView<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (visible || element === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true);
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return { visible, ref };
}
