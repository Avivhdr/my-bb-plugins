import { describe, expect, it } from "vitest";
import { commentStops } from "./comment-stops";
import type { ListedCommentDraft } from "./review-drafts";
import type { ReviewThread } from "./review-threads";
import type { ThreadPlacement } from "./thread-placement";

const files = [{ path: "a.ts" }, { path: "b.ts" }];

function thread(id: string, fields: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id,
    resolved: false,
    outdated: false,
    path: "a.ts",
    line: 1,
    originalLine: 1,
    side: "RIGHT",
    comments: [],
    hasMoreComments: false,
    ...fields,
  };
}

function placed(
  id: string,
  path: string,
  lineNumber: number,
  side: "additions" | "deletions" = "additions",
  fields: Partial<ReviewThread> = {},
): ThreadPlacement["placed"][number] {
  return { thread: thread(id, { path, ...fields }), side, lineNumber };
}

function draft(
  id: string,
  path: string,
  line: number,
  side: "LEFT" | "RIGHT" = "RIGHT",
): ListedCommentDraft {
  return {
    id,
    path,
    line,
    side,
    startLine: null,
    body: "",
    commitOid: "head",
    updatedAt: 0,
    source: "agent",
  };
}

const none = { placed: [], outdated: [] } satisfies ThreadPlacement;
const noIds: ReadonlySet<string> = new Set();

describe("commentStops", () => {
  it("orders outdated threads first, then each file in file order by line", () => {
    const stops = commentStops({
      files,
      threads: {
        placed: [placed("b7", "b.ts", 7), placed("a40", "a.ts", 40)],
        outdated: [thread("old")],
      },
      olderDrafts: [],
      drafts: [draft("a12", "a.ts", 12)],
      showResolved: false,
      revealedThreadIds: noIds,
    });

    expect(stops).toEqual([
      { kind: "thread", id: "old", filePath: null },
      { kind: "draft", id: "a12", filePath: "a.ts" },
      { kind: "thread", id: "a40", filePath: "a.ts" },
      { kind: "thread", id: "b7", filePath: "b.ts" },
    ]);
  });

  it("puts older drafts before outdated threads", () => {
    const stops = commentStops({
      files,
      threads: { placed: [], outdated: [thread("old")] },
      olderDrafts: [draft("stale", "a.ts", 3)],
      drafts: [],
      showResolved: false,
      revealedThreadIds: noIds,
    });

    expect(stops.map(({ id }) => id)).toEqual(["stale", "old"]);
    expect(stops[0]).toEqual({ kind: "draft", id: "stale", filePath: null });
  });

  it("puts the old side before the new side, and threads before drafts, on one line", () => {
    const stops = commentStops({
      files,
      threads: {
        placed: [
          placed("new-thread", "a.ts", 5, "additions"),
          placed("old-thread", "a.ts", 5, "deletions"),
        ],
        outdated: [],
      },
      olderDrafts: [],
      drafts: [draft("new-draft", "a.ts", 5, "RIGHT"), draft("old-draft", "a.ts", 5, "LEFT")],
      showResolved: false,
      revealedThreadIds: noIds,
    });

    expect(stops.map(({ id }) => id)).toEqual([
      "old-thread",
      "old-draft",
      "new-thread",
      "new-draft",
    ]);
  });

  it("leaves out resolved threads unless show resolved is on", () => {
    const threads: ThreadPlacement = {
      placed: [
        placed("open", "a.ts", 1),
        placed("done", "a.ts", 2, "additions", { resolved: true }),
      ],
      outdated: [thread("done-old", { resolved: true })],
    };
    const input = { files, threads, olderDrafts: [], drafts: [], revealedThreadIds: noIds };

    expect(commentStops({ ...input, showResolved: false }).map(({ id }) => id)).toEqual(["open"]);
    expect(commentStops({ ...input, showResolved: true }).map(({ id }) => id)).toEqual([
      "done-old",
      "open",
      "done",
    ]);
  });

  it("keeps a resolved thread with a new comment when show resolved is off", () => {
    const threads: ThreadPlacement = {
      placed: [
        placed("open", "a.ts", 1),
        placed("done", "a.ts", 2, "additions", { resolved: true }),
      ],
      outdated: [],
    };

    expect(
      commentStops({
        files,
        threads,
        olderDrafts: [],
        drafts: [],
        showResolved: false,
        revealedThreadIds: new Set(["done"]),
      }).map(({ id }) => id),
    ).toEqual(["open", "done"]);
  });

  it("leaves out drafts on a file that is not in the PR", () => {
    const stops = commentStops({
      files,
      threads: none,
      olderDrafts: [],
      drafts: [draft("gone", "c.ts", 1)],
      showResolved: false,
      revealedThreadIds: noIds,
    });

    expect(stops).toEqual([]);
  });
});
