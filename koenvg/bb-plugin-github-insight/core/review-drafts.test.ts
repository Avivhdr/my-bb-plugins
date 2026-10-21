import { describe, expect, it } from "vitest";
import {
  commentDraftEntry,
  readCommentDraft,
  readSummaryDraft,
  summaryDraftEntry,
  type CommentDraft,
  type SummaryDraft,
} from "./review-drafts";

const comment: CommentDraft = {
  path: "src/a.ts",
  side: "RIGHT",
  line: 42,
  startLine: 40,
  body: "Null check missing",
  commitOid: "abc123",
  updatedAt: 1_000,
  source: "agent",
};

const summary: SummaryDraft = { body: "Looks good", updatedAt: 2_000, source: "agent" };

describe("comment draft entries", () => {
  it("writes a version 1 entry", () => {
    expect(commentDraftEntry(comment)).toEqual({ v: 1, ...comment });
  });

  it("reads back the entry it writes", () => {
    expect(readCommentDraft(commentDraftEntry(comment))).toEqual(comment);
  });

  it.each([
    ["no entry", undefined],
    ["an entry that is not an object", "draft"],
    ["an entry without a version", comment],
    ["an entry of another version", { ...comment, v: 2 }],
    ["an entry with an unknown side", { ...comment, v: 1, side: "BOTH" }],
    ["an entry with a text line", { ...comment, v: 1, line: "42" }],
    ["an entry without a commit", { ...comment, v: 1, commitOid: undefined }],
  ])("reads %s as no draft", (_, entry) => {
    expect(readCommentDraft(entry)).toBeNull();
  });
});

describe("summary draft entries", () => {
  it("writes a version 1 entry", () => {
    expect(summaryDraftEntry(summary)).toEqual({ v: 1, ...summary });
  });

  it("reads back the entry it writes", () => {
    expect(readSummaryDraft(summaryDraftEntry(summary))).toEqual(summary);
  });

  it.each([
    ["no entry", undefined],
    ["an entry without a version", summary],
    ["an entry of another version", { ...summary, v: 2 }],
    ["an entry without a body", { ...summary, v: 1, body: undefined }],
    ["an entry with an unknown source", { ...summary, v: 1, source: "bot" }],
  ])("reads %s as no draft", (_, entry) => {
    expect(readSummaryDraft(entry)).toBeNull();
  });
});
