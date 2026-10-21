import { isVideoPath } from "../core/video-content";
import { ReviewVideoDiff } from "../../review-ui/video-diff";
import { useCallback } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { isRasterPath } from "../core/image-content";
import { imageBasisKey, type PrImageBasis } from "../core/pr-image-basis";
import { ReviewImageDiff, imageBlobResult, type ImageSide } from "../../review-ui/image-diff";
import { useEffect, useMemo, useRef, useState } from "react";
import { parsePatchFiles, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import { experimental_useCodeTheme as useCodeTheme } from "@get-bb/plugin-sdk/app";
import { gitPatch, type ReviewFile } from "../core/pr-files";
import type { DiffSide } from "../core/diff-lines";
import type { DiffSide as PierreSide } from "../../review-ui/diff-lines";
import type { ListedCommentDraft } from "../core/review-drafts";
import type { ReviewThread } from "../core/review-threads";
import type { PlacedThread } from "../core/thread-placement";
import { Icon } from "@/components/ui/icon";
import { ReviewFileDiff } from "../../review-ui/review-file-diff";
import { CollapseButton, ViewedCheckbox } from "../../review-ui/viewed-controls";
import { CommentDraftCard } from "./comment-drafts";
import { ReviewThreadCard } from "./review-thread";
import type { FileViewedState } from "./use-pr-viewed";

interface ThreadsProps {
  threads: readonly PlacedThread[];
  commentDrafts: readonly ListedCommentDraft[];
}

type AddComment = (path: string, side: DiffSide, line: number) => void;

function toPierreSide(side: DiffSide): PierreSide {
  return side === "RIGHT" ? "additions" : "deletions";
}

function fromPierreSide(side: PierreSide): DiffSide {
  return side === "additions" ? "RIGHT" : "LEFT";
}

type Annotation =
  | { kind: "thread"; thread: ReviewThread }
  | { kind: "comment-draft"; draft: ListedCommentDraft };

export function PrFileDiff({
  file,
  threads,
  commentDrafts,
  onAddComment,
  viewed,
  image,
}: ThreadsProps & {
  file: ReviewFile;
  onAddComment?: AddComment;
  viewed?: FileViewedState;
  image?: { threadId: string; basis: PrImageBasis | null; active: boolean; generation: number };
}) {
  const fileDiff = useMemo(() => parseFileDiff(file), [file]);
  if (
    isRasterPath(file.path) ||
    isRasterPath(file.previousPath ?? "") ||
    (file.patch === null && (isVideoPath(file.path) || isVideoPath(file.previousPath ?? "")))
  )
    return (
      <PrPreviewFile file={file} image={image} threads={threads} commentDrafts={commentDrafts} />
    );
  if (fileDiff === null)
    return <UnavailableFileDiff path={file.path} threads={threads} commentDrafts={commentDrafts} />;
  return (
    <LazyFileDiff
      path={file.path}
      fileDiff={fileDiff}
      threads={threads}
      commentDrafts={commentDrafts}
      viewed={viewed}
      onAddComment={
        onAddComment && ((side, line) => onAddComment(file.path, fromPierreSide(side), line))
      }
    />
  );
}

function PrPreviewFile({
  file,
  image,
  threads,
  commentDrafts,
}: ThreadsProps & {
  file: ReviewFile;
  image?: { threadId: string; basis: PrImageBasis | null; active: boolean; generation: number };
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [collapsed, setCollapsed] = useState(false);
  const video = isVideoPath(file.path) || isVideoPath(file.previousPath ?? "");
  const Preview = video ? ReviewVideoDiff : ReviewImageDiff;
  const basis = image?.basis;
  const threadId = image?.threadId;
  const load = useCallback(
    async (side: ImageSide, signal: AbortSignal) => {
      if (!basis || !threadId)
        return {
          kind: "error" as const,
          code: "stale" as const,
          message: "Preview revision unavailable. Refresh the review.",
        };
      const result = await rpc.call(video ? "getPrVideo" : "getPrImage", {
        threadId,
        expectedBasisKey: imageBasisKey(basis),
        path: file.path,
        side,
      });
      signal.throwIfAborted();
      return imageBlobResult(result);
    },
    [rpc, basis, threadId, file.path, video],
  );
  return (
    <section data-path={file.path} className="border-b border-border">
      <div className="flex min-h-11 items-center gap-2 px-3 text-xs">
        <CollapseButton
          path={file.path}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          icons={CHEVRONS}
        />
        <span className="min-w-0 break-all font-mono">
          {file.previousPath ? `${file.previousPath} → ${file.path}` : file.path}
        </span>
        <ThreadCount count={threads.length} />
      </div>
      {!collapsed && (
        <Preview
          key={JSON.stringify([
            image?.threadId,
            image?.generation,
            basis,
            file.path,
            file.previousPath,
          ])}
          active={image?.active ?? true}
          before={
            file.status === "added"
              ? null
              : {
                  path: file.previousPath ?? file.path,
                  revision: basis?.mergeBaseSha ?? "Revision unavailable",
                }
          }
          after={
            file.status === "removed"
              ? null
              : { path: file.path, revision: basis?.headSha ?? "Revision unavailable" }
          }
          load={load}
        />
      )}
      {threads.map(({ thread }) => (
        <ReviewThreadCard key={thread.id} thread={thread} />
      ))}
      {commentDrafts.map((draft) => (
        <CommentDraftCard key={draft.id} draft={draft} />
      ))}
    </section>
  );
}

function UnavailableFileDiff({ path, threads, commentDrafts }: ThreadsProps & { path: string }) {
  return (
    <section
      data-path={path}
      className="flex flex-col gap-1 border-b border-border px-3 py-2 text-sm"
    >
      <span className="font-mono text-xs">{path}</span>
      <span className="text-xs text-muted-foreground">Diff not available</span>
      {threads.map(({ thread }) => (
        <ReviewThreadCard key={thread.id} thread={thread} />
      ))}
      {commentDrafts.map((draft) => (
        <CommentDraftCard key={draft.id} draft={draft} />
      ))}
    </section>
  );
}

function LazyFileDiff({
  path,
  fileDiff,
  threads,
  commentDrafts,
  onAddComment,
  viewed,
}: ThreadsProps & {
  path: string;
  fileDiff: FileDiffMetadata;
  onAddComment?: (side: PierreSide, line: number) => void;
  viewed?: FileViewedState;
}) {
  const { visible, ref } = useVisibleOnce<HTMLElement>();
  const theme = useCodeTheme();
  const lineAnnotations = useMemo(
    (): DiffLineAnnotation<Annotation>[] => [
      ...threads.map(({ thread, side, lineNumber }) => ({
        side,
        lineNumber,
        metadata: { kind: "thread" as const, thread },
      })),
      ...commentDrafts.map((draft) => ({
        side: toPierreSide(draft.side),
        lineNumber: draft.line,
        metadata: { kind: "comment-draft" as const, draft },
      })),
    ],
    [threads, commentDrafts],
  );
  return (
    <section ref={ref} data-path={path} className="min-h-10 border-b border-border">
      {visible && (
        <ReviewFileDiff
          fileDiff={fileDiff}
          annotations={lineAnnotations}
          onAddComment={onAddComment}
          view="split"
          theme={theme}
          collapsed={viewed?.collapsed}
          onToggleCollapsed={viewed?.toggleCollapsed}
          headerPrefix={
            viewed && (
              <CollapseButton
                path={path}
                collapsed={viewed.collapsed}
                onToggle={viewed.toggleCollapsed}
                icons={CHEVRONS}
              />
            )
          }
          headerMetadata={
            <>
              <ThreadCount count={threads.length} />
              {viewed && (
                <ViewedCheckbox
                  path={path}
                  checked={viewed.viewed}
                  onToggle={viewed.toggleViewed}
                />
              )}
            </>
          }
          renderAnnotation={({ metadata }) =>
            metadata.kind === "thread" ? (
              <ReviewThreadCard key={metadata.thread.id} thread={metadata.thread} />
            ) : (
              <CommentDraftCard key={metadata.draft.id} draft={metadata.draft} />
            )
          }
        />
      )}
    </section>
  );
}

const CHEVRONS = {
  collapsed: <Icon name="ChevronRight" className="size-3.5" />,
  expanded: <Icon name="ChevronDown" className="size-3.5" />,
};

function ThreadCount({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 font-sans text-xs text-muted-foreground tabular-nums">
      <Icon name="MessageSquare" className="size-3.5" />
      {count}
    </span>
  );
}

function parseFileDiff(file: ReviewFile): FileDiffMetadata | null {
  const patch = gitPatch(file);
  if (patch === null) return null;
  try {
    const files = parsePatchFiles(patch, undefined, true).flatMap((parsed) => parsed.files);
    return files.length === 1 ? files[0]! : null;
  } catch {
    return null;
  }
}

function useVisibleOnce<T extends Element>() {
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
