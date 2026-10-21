import { z } from "zod";
import { diffLines } from "./diff-lines";
import type { ReviewFile } from "./pr-files";
import { reviewThreadSchema, type ReviewThread } from "./review-threads";

export const placedThreadSchema = z.object({
  thread: reviewThreadSchema,
  side: z.enum(["additions", "deletions"]),
  lineNumber: z.number(),
});
export type PlacedThread = z.infer<typeof placedThreadSchema>;

export const threadPlacementSchema = z.object({
  placed: z.array(placedThreadSchema),
  outdated: z.array(reviewThreadSchema),
});
export type ThreadPlacement = z.infer<typeof threadPlacementSchema>;

export function placeThreads(files: ReviewFile[], threads: ReviewThread[]): ThreadPlacement {
  const linesByPath = new Map(
    files.flatMap((file) =>
      file.patch === null ? [] : [[file.path, diffLines(file.patch)] as const],
    ),
  );
  const placement: ThreadPlacement = { placed: [], outdated: [] };
  for (const thread of threads) {
    const side = thread.side === "RIGHT" ? "additions" : "deletions";
    const lines = linesByPath.get(thread.path);
    if (thread.outdated || thread.line === null || !lines?.[side].has(thread.line)) {
      placement.outdated.push(thread);
    } else {
      placement.placed.push({ thread, side, lineNumber: thread.line });
    }
  }
  return placement;
}

export function visibleThreads(
  threads: ThreadPlacement,
  showResolved: boolean,
  revealedThreadIds: ReadonlySet<string>,
): ThreadPlacement {
  if (showResolved) return threads;
  const shows = (thread: ReviewThread) => !thread.resolved || revealedThreadIds.has(thread.id);
  return {
    placed: threads.placed.filter(({ thread }) => shows(thread)),
    outdated: threads.outdated.filter(shows),
  };
}

export interface CommentHolders {
  threadIds: Set<string>;
  paths: Set<string>;
}

export function commentHolders(
  placement: ThreadPlacement,
  commentIds: ReadonlySet<string>,
): CommentHolders {
  const holds = (thread: ReviewThread) => thread.comments.some(({ id }) => commentIds.has(id));
  const placed = placement.placed.filter(({ thread }) => holds(thread));
  const outdated = placement.outdated.filter(holds);
  return {
    threadIds: new Set([...placed.map(({ thread }) => thread.id), ...outdated.map(({ id }) => id)]),
    paths: new Set(placed.map(({ thread }) => thread.path)),
  };
}

export function openThreadCounts(placement: ThreadPlacement): { open: number; outdated: number } {
  const outdated = placement.outdated.filter((thread) => !thread.resolved).length;
  const placed = placement.placed.filter(({ thread }) => !thread.resolved).length;
  return { open: placed + outdated, outdated };
}

export interface OpenThread {
  thread: ReviewThread;
  line: number | null;
  outdated: boolean;
}

export function openThreads(placement: ThreadPlacement): OpenThread[] {
  return [
    ...placement.placed
      .filter(({ thread }) => !thread.resolved)
      .map(({ thread, lineNumber }) => ({ thread, line: lineNumber, outdated: false })),
    ...placement.outdated
      .filter((thread) => !thread.resolved)
      .map((thread) => ({ thread, line: thread.originalLine, outdated: true })),
  ];
}

export function threadsWithComments(
  threads: ThreadPlacement,
  commentIds: readonly string[],
): ReviewThread[] {
  const wanted = new Set(commentIds);
  return [...threads.placed.map(({ thread }) => thread), ...threads.outdated].filter((thread) =>
    thread.comments.some(({ id }) => wanted.has(id)),
  );
}
