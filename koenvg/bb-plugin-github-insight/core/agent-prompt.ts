import { capCommentBody } from "./review-threads";
import type { OpenThread } from "./thread-placement";

export const SNIPPET_LINES = 10;

const RULES = [
  "Address the comments in the code.",
  "For each review thread, save a draft reply with `bb github-insight review draft <thread-id> --body-file <file>`. Say what you changed, or why you did not change the code.",
  "Do not post to GitHub and do not resolve review threads. The user reads the drafts and posts them.",
];

export function buildAgentPrompt(threads: readonly OpenThread[]): string {
  const sections = [
    "Address these review threads of the pull request.",
    ...threads.flatMap(threadSection),
    "## Rules",
    RULES.map((rule) => `- ${rule}`).join("\n"),
  ];
  return `${sections.join("\n\n")}\n`;
}

function threadSection({ thread, line, outdated }: OpenThread): string[] {
  const location = `File: ${thread.path}, ${line === null ? "line unknown" : `line ${line}`}`;
  const snippet = snippetOf(thread.comments[0]?.diffHunk ?? "");
  const lastUrl = thread.comments.at(-1)?.url;
  return [
    `## Review thread ${thread.id}`,
    outdated ? `${location} (outdated: the code changed since this comment)` : location,
    ...(snippet === null ? [] : [fenced(snippet)]),
    ...thread.comments.flatMap((comment) => [
      `${comment.author} wrote:`,
      capCommentBody(comment.body),
    ]),
    ...(thread.hasMoreComments && lastUrl !== undefined
      ? [`More comments on GitHub: ${lastUrl}`]
      : []),
  ];
}

function snippetOf(diffHunk: string): string | null {
  if (diffHunk === "") return null;
  return diffHunk.split("\n").slice(-SNIPPET_LINES).join("\n");
}

function fenced(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}diff\n${text}\n${fence}`;
}
