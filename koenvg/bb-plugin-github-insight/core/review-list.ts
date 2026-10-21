import type { Drafts } from "./drafts";
import type { ListedCommentDraft, SummaryDraft } from "./review-drafts";
import { capCommentBody } from "./review-threads";
import { openThreads, type ThreadPlacement } from "./thread-placement";

export interface ReviewListComment {
  author: string;
  createdAt: string;
  body: string;
  url: string;
}

export interface ReviewListEntry {
  id: string;
  path: string;
  line: number | null;
  outdated: boolean;
  hasDraft: boolean;
  hasMoreComments: boolean;
  comments: ReviewListComment[];
}

export function reviewListEntries(placement: ThreadPlacement, drafts: Drafts): ReviewListEntry[] {
  return openThreads(placement).map(({ thread, line, outdated }) => ({
    id: thread.id,
    path: thread.path,
    line,
    outdated,
    hasDraft: thread.id in drafts,
    hasMoreComments: thread.hasMoreComments,
    comments: thread.comments.map(({ author, createdAt, body, url }) => ({
      author,
      createdAt,
      body: capCommentBody(body),
      url,
    })),
  }));
}

export function formatReviewList(entries: readonly ReviewListEntry[]): string {
  if (entries.length === 0) return "No unresolved review threads\n";
  return entries.map(formatEntry).join("\n");
}

function formatEntry(entry: ReviewListEntry): string {
  const tags = [entry.outdated && "[outdated]", entry.hasDraft && "[draft]"]
    .filter(Boolean)
    .join(" ");
  const heading = `${entry.id}  ${entry.path}:${entry.line ?? "?"}`;
  const lines = [tags === "" ? heading : `${heading}  ${tags}`];
  for (const comment of entry.comments) {
    lines.push(`  ${comment.author}, ${comment.createdAt}:`);
    lines.push(...comment.body.split("\n").map((text) => `    ${text}`));
  }
  if (entry.hasMoreComments) lines.push("  More comments on GitHub");
  return `${lines.join("\n")}\n`;
}

export type ReviewCommentEntry = Omit<ListedCommentDraft, "updatedAt" | "source">;

export function reviewCommentEntries(drafts: readonly ListedCommentDraft[]): ReviewCommentEntry[] {
  return drafts.map(({ updatedAt: _, source: __, ...entry }) => entry);
}

export function formatReviewDrafts(
  comments: readonly ReviewCommentEntry[],
  summary: SummaryDraft | null,
): string {
  const sections: string[] = [];
  if (comments.length > 0) {
    const lines = ["Comment drafts:"];
    for (const { id, path, side, line, startLine, body } of comments) {
      lines.push(
        `${id}  ${path}:${startLine === null ? line : `${startLine}-${line}`}  ${side}`,
        ...indented(body),
      );
    }
    sections.push(`${lines.join("\n")}\n`);
  }
  if (summary !== null)
    sections.push(`${["Summary draft:", ...indented(summary.body)].join("\n")}\n`);
  return sections.join("\n");
}

function indented(body: string): string[] {
  return body.split("\n").map((text) => `    ${text}`);
}
