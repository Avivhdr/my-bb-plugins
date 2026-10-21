import { describe, expect, it } from "vitest";
import type { PendingComment } from "./pending-review";
import { buildReviewPrompt } from "./review-prompt";

function comment(
  path: string,
  side: PendingComment["side"],
  line: number,
  body: string,
): PendingComment {
  return { id: `${path}:${line}`, path, side, line, body };
}

describe("buildReviewPrompt", () => {
  it("lists the comments sorted by path and line, with deleted lines marked", () => {
    const prompt = buildReviewPrompt([
      comment("src/b.ts", "deletions", 10, "Why remove this?"),
      comment("src/a.ts", "additions", 42, "Null check missing"),
      comment("src/a.ts", "additions", 7, "Rename this"),
    ]);

    expect(prompt).toBe(
      [
        "Please address the following review comments:",
        "",
        "1. `src/a.ts:7` - Rename this",
        "2. `src/a.ts:42` - Null check missing",
        "3. `src/b.ts:10 (deleted line)` - Why remove this?",
        "",
        "Check each comment against the current code before you change anything.",
        "Fix the valid ones at their location.",
        "If a comment is invalid, stale, or already addressed, do not change code for it, and explain why.",
      ].join("\n"),
    );
  });

  it("lists comments in a subfolder before comments on files of the parent folder", () => {
    const prompt = buildReviewPrompt([
      comment("src/b.ts", "additions", 1, "Parent file"),
      comment("src/ui/a.ts", "additions", 9, "Second in a.ts"),
      comment("src/ui/a.ts", "deletions", 2, "First in a.ts"),
    ]);

    expect(prompt).toContain(
      "1. `src/ui/a.ts:2 (deleted line)` - First in a.ts\n2. `src/ui/a.ts:9` - Second in a.ts\n3. `src/b.ts:1` - Parent file",
    );
  });

  it("indents the next lines of a multi-line comment under its item", () => {
    const prompt = buildReviewPrompt([
      comment("a.ts", "additions", 1, "First line\nSecond line\n"),
    ]);

    expect(prompt).toContain("1. `a.ts:1` - First line\n   Second line\n\n");
  });

  it("never asks for version-control actions", () => {
    const prompt = buildReviewPrompt([comment("a.ts", "additions", 1, "x")]);

    expect(prompt).not.toMatch(/\b(commit|push|pull request|PR)\b/i);
  });
});
