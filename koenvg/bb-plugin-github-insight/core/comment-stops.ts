import type { DiffSide } from "./diff-lines";
import type { ListedCommentDraft } from "./review-drafts";
import { visibleThreads, type ThreadPlacement } from "./thread-placement";

export interface CommentStop {
  kind: "thread" | "draft";
  id: string;
  filePath: string | null;
}

interface FileComment {
  stop: CommentStop;
  line: number;
  side: DiffSide;
}

const SIDE_ORDER: Record<DiffSide, number> = { LEFT: 0, RIGHT: 1 };
const KIND_ORDER: Record<CommentStop["kind"], number> = { thread: 0, draft: 1 };

export function commentStops({
  files,
  threads,
  olderDrafts,
  drafts,
  showResolved,
  revealedThreadIds,
}: {
  files: readonly { path: string }[];
  threads: ThreadPlacement;
  olderDrafts: readonly ListedCommentDraft[];
  drafts: readonly ListedCommentDraft[];
  showResolved: boolean;
  revealedThreadIds: ReadonlySet<string>;
}): CommentStop[] {
  const visible = visibleThreads(threads, showResolved, revealedThreadIds);
  const byPath = new Map<string, FileComment[]>(files.map((file) => [file.path, []]));
  for (const { thread, side, lineNumber } of visible.placed) {
    byPath.get(thread.path)?.push({
      stop: { kind: "thread", id: thread.id, filePath: thread.path },
      line: lineNumber,
      side: side === "deletions" ? "LEFT" : "RIGHT",
    });
  }
  for (const draft of drafts) {
    byPath.get(draft.path)?.push({
      stop: { kind: "draft", id: draft.id, filePath: draft.path },
      line: draft.line,
      side: draft.side,
    });
  }
  return [
    ...olderDrafts.map((draft): CommentStop => ({ kind: "draft", id: draft.id, filePath: null })),
    ...visible.outdated.map((thread): CommentStop => ({
      kind: "thread",
      id: thread.id,
      filePath: null,
    })),
    ...[...byPath.values()].flatMap((comments) =>
      comments.sort(byPlaceInFile).map(({ stop }) => stop),
    ),
  ];
}

function byPlaceInFile(a: FileComment, b: FileComment): number {
  return (
    a.line - b.line ||
    SIDE_ORDER[a.side] - SIDE_ORDER[b.side] ||
    KIND_ORDER[a.stop.kind] - KIND_ORDER[b.stop.kind]
  );
}
