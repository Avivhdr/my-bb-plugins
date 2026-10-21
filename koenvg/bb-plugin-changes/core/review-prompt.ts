import { compareFilePaths } from "./file-order";
import type { PendingComment } from "./pending-review";

const OPENING = "Please address the following review comments:";

const CLOSING = [
  "Check each comment against the current code before you change anything.",
  "Fix the valid ones at their location.",
  "If a comment is invalid, stale, or already addressed, do not change code for it, and explain why.",
].join("\n");

export function sortComments(comments: readonly PendingComment[]): PendingComment[] {
  return [...comments].sort((a, b) =>
    a.path === b.path
      ? a.line - b.line || a.side.localeCompare(b.side)
      : compareFilePaths(a.path, b.path),
  );
}

export function buildReviewPrompt(comments: readonly PendingComment[]): string {
  const items = sortComments(comments).map((comment, index) => {
    const prefix = `${index + 1}. `;
    const location = `\`${comment.path}:${comment.line}${comment.side === "deletions" ? " (deleted line)" : ""}\``;
    const body = comment.body
      .trim()
      .split("\n")
      .join(`\n${" ".repeat(prefix.length)}`);
    return `${prefix}${location} - ${body}`;
  });
  return [OPENING, items.join("\n"), CLOSING].join("\n\n");
}
