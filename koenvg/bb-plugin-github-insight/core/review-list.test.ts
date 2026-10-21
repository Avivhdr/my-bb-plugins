import { describe, expect, it } from "vitest";
import prFiles from "../test/fixtures/pr-25259-files.json";
import reviewThreads from "../test/fixtures/pr-25259-review-threads.json";
import { parsePrFiles } from "./pr-files";
import type { ListedCommentDraft } from "./review-drafts";
import {
  formatReviewDrafts,
  formatReviewList,
  reviewListEntries,
  type ReviewListEntry,
} from "./review-list";
import { MAX_COMMENT_BODY_CHARS, parseReviewThreads } from "./review-threads";
import { placeThreads } from "./thread-placement";

const placement = placeThreads(parsePrFiles(prFiles), parseReviewThreads([reviewThreads]));
const draft = { body: "Fixed", updatedAt: 1, source: "agent" as const };

describe("reviewListEntries", () => {
  it("lists the unresolved threads with their line and outdated state", () => {
    const entries = reviewListEntries(placement, {});

    expect(entries.map(({ id, line, outdated }) => [id, line, outdated])).toEqual([
      ["PRRT_kwDOHI7l-86jxqt3", 151, false],
      ["PRRT_kwDOHI7l-86jxula", 46, false],
      ["PRRT_kwDOHI7l-86jx0SN", 32, true],
    ]);
  });

  it("flags the threads that have a draft", () => {
    const entries = reviewListEntries(placement, { "PRRT_kwDOHI7l-86jxula": draft });

    expect(entries.filter((entry) => entry.hasDraft).map((entry) => entry.id)).toEqual([
      "PRRT_kwDOHI7l-86jxula",
    ]);
  });

  it("keeps each comment's author, time, body, and url", () => {
    const [first] = reviewListEntries(placement, {});

    expect(first!.comments[0]).toEqual({
      author: "a-bandziuk",
      createdAt: "2026-09-18T14:31:50Z",
      body: expect.stringMatching(/^\S/),
      url: expect.stringMatching(/^https:\/\/github\.com\//),
    });
  });

  it("cuts a comment body at 4000 characters", () => {
    const [placed] = placement.placed;
    const longComment = {
      ...placed!.thread.comments[0]!,
      body: "x".repeat(MAX_COMMENT_BODY_CHARS + 1),
    };
    const entries = reviewListEntries(
      {
        placed: [{ ...placed!, thread: { ...placed!.thread, comments: [longComment] } }],
        outdated: [],
      },
      {},
    );

    expect(entries[0]!.comments[0]!.body).toBe(
      `${"x".repeat(MAX_COMMENT_BODY_CHARS)}\n[cut at 4000 characters]`,
    );
  });
});

describe("formatReviewList", () => {
  const entry: ReviewListEntry = {
    id: "PRRT_a",
    path: "src/a.ts",
    line: 12,
    outdated: true,
    hasDraft: true,
    hasMoreComments: false,
    comments: [
      {
        author: "alice",
        createdAt: "2026-09-18T14:34:40Z",
        body: "Rename this.\nPlease.",
        url: "u1",
      },
      { author: "bob", createdAt: "2026-09-18T15:00:00Z", body: "Agreed.", url: "u2" },
    ],
  };

  it("prints each thread with its tags and indented comments", () => {
    expect(formatReviewList([entry])).toBe(
      [
        "PRRT_a  src/a.ts:12  [outdated] [draft]",
        "  alice, 2026-09-18T14:34:40Z:",
        "    Rename this.",
        "    Please.",
        "  bob, 2026-09-18T15:00:00Z:",
        "    Agreed.",
        "",
      ].join("\n"),
    );
  });

  it("marks an unknown line and more comments on GitHub", () => {
    const text = formatReviewList([
      {
        ...entry,
        line: null,
        outdated: false,
        hasDraft: false,
        hasMoreComments: true,
        comments: [],
      },
    ]);

    expect(text).toBe("PRRT_a  src/a.ts:?\n  More comments on GitHub\n");
  });

  it("separates threads with an empty line", () => {
    const one = { ...entry, comments: [] };

    expect(formatReviewList([one, { ...one, id: "PRRT_b" }])).toBe(
      "PRRT_a  src/a.ts:12  [outdated] [draft]\n\nPRRT_b  src/a.ts:12  [outdated] [draft]\n",
    );
  });

  it("says when no thread is open", () => {
    expect(formatReviewList([])).toBe("No unresolved review threads\n");
  });
});

describe("formatReviewDrafts", () => {
  const comment: ListedCommentDraft = {
    id: "a1b2c3d4",
    path: "src/a.ts",
    side: "RIGHT",
    line: 42,
    startLine: null,
    body: "Null check missing.\nSee below.",
    commitOid: "abc123",
    updatedAt: 1,
    source: "agent",
  };

  it("prints nothing without drafts", () => {
    expect(formatReviewDrafts([], null)).toBe("");
  });

  it("prints each comment draft with its id, path, line or range, side, and body, then the summary", () => {
    const range = {
      ...comment,
      id: "e5f6a7b8",
      side: "LEFT" as const,
      startLine: 10,
      line: 12,
      body: "Why?",
    };

    expect(
      formatReviewDrafts([comment, range], { body: "Looks good.", updatedAt: 1, source: "agent" }),
    ).toBe(
      [
        "Comment drafts:",
        "a1b2c3d4  src/a.ts:42  RIGHT",
        "    Null check missing.",
        "    See below.",
        "e5f6a7b8  src/a.ts:10-12  LEFT",
        "    Why?",
        "",
        "Summary draft:",
        "    Looks good.",
        "",
      ].join("\n"),
    );
  });

  it("prints only the summary when there are no comment drafts", () => {
    expect(formatReviewDrafts([], { body: "LGTM", updatedAt: 1, source: "user" })).toBe(
      "Summary draft:\n    LGTM\n",
    );
  });
});
