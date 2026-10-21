import { describe, expect, it } from "vitest";
import type { ListedCommentDraft } from "./review-drafts";
import { draftLineText, newCommitsText } from "./comment-draft-view";
import { splitByCommit } from "./draft-commits";

function draft(id: string, overrides: Partial<ListedCommentDraft> = {}): ListedCommentDraft {
  return {
    id,
    path: "src/a.ts",
    side: "RIGHT",
    line: 42,
    startLine: null,
    body: "Null check missing",
    commitOid: "def456",
    updatedAt: 1,
    source: "agent",
    ...overrides,
  };
}

describe("splitByCommit", () => {
  it("puts drafts at the head commit on their lines and the others in the older list", () => {
    const atHead = draft("a");
    const older = draft("b", { commitOid: "abc123" });

    expect(splitByCommit([atHead, older], "def456")).toEqual({ atHead: [atHead], older: [older] });
  });
});

describe("draftLineText", () => {
  it("names one line", () => {
    expect(draftLineText(draft("a"))).toBe("Line 42");
  });

  it("names a range", () => {
    expect(draftLineText(draft("a", { startLine: 40 }))).toBe("Lines 40-42");
  });
});

describe("newCommitsText", () => {
  it("names the short draft commit and the short head commit", () => {
    expect(newCommitsText("abc1234567890", "def4567890123")).toBe(
      "PR has new commits since these drafts (abc1234 -> def4567)",
    );
  });

  it("keeps a commit shorter than 7 characters as is", () => {
    expect(newCommitsText("abc123", "def456")).toBe(
      "PR has new commits since these drafts (abc123 -> def456)",
    );
  });
});
