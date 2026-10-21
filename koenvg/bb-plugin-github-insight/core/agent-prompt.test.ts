import { describe, expect, it } from "vitest";
import { buildAgentPrompt, SNIPPET_LINES } from "./agent-prompt";
import type { ReviewComment, ReviewThread } from "./review-threads";
import type { OpenThread } from "./thread-placement";

function comment(author: string, body: string, diffHunk = ""): ReviewComment {
  return {
    id: `c_${author}`,
    author,
    avatarUrl: null,
    body,
    createdAt: "2026-09-18T14:31:50Z",
    url: `https://github.com/o/r/pull/1#${author}`,
    diffHunk,
  };
}

function thread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: "PRRT_one",
    resolved: false,
    outdated: false,
    path: "src/grid.ts",
    line: 12,
    originalLine: 12,
    side: "RIGHT",
    comments: [],
    hasMoreComments: false,
    ...overrides,
  };
}

const HUNK =
  "@@ -10,3 +10,4 @@ export function grid() {\n   const rows = [];\n-  rows.push(1);\n+  rows.push(2);\n+  return rows;";

describe("buildAgentPrompt", () => {
  it("lists each thread with its id, path, line, snippet, and comments, then the rules", () => {
    const threads: OpenThread[] = [
      {
        thread: thread({
          comments: [comment("reviewer", "Why push 2?", HUNK), comment("author", "Good point.")],
        }),
        line: 12,
        outdated: false,
      },
      {
        thread: thread({
          id: "PRRT_two",
          path: "src/old.ts",
          line: null,
          originalLine: 7,
          outdated: true,
          comments: [comment("reviewer", "Rename this.")],
        }),
        line: 7,
        outdated: true,
      },
    ];

    expect(buildAgentPrompt(threads)).toMatchInlineSnapshot(`
      "Address these review threads of the pull request.

      ## Review thread PRRT_one

      File: src/grid.ts, line 12

      \`\`\`diff
      @@ -10,3 +10,4 @@ export function grid() {
         const rows = [];
      -  rows.push(1);
      +  rows.push(2);
      +  return rows;
      \`\`\`

      reviewer wrote:

      Why push 2?

      author wrote:

      Good point.

      ## Review thread PRRT_two

      File: src/old.ts, line 7 (outdated: the code changed since this comment)

      reviewer wrote:

      Rename this.

      ## Rules

      - Address the comments in the code.
      - For each review thread, save a draft reply with \`bb github-insight review draft <thread-id> --body-file <file>\`. Say what you changed, or why you did not change the code.
      - Do not post to GitHub and do not resolve review threads. The user reads the drafts and posts them.
      "
    `);
  });

  it.each([10, 30])(
    "keeps only the last lines of a snippet with %i lines below its hunk header",
    (length) => {
      const body = Array.from({ length }, (_, index) => ` line ${index + 1}`);
      const hunk = [`@@ -1,${length} +1,${length} @@`, ...body].join("\n");

      const prompt = buildAgentPrompt([
        {
          thread: thread({ comments: [comment("reviewer", "Hm", hunk)] }),
          line: 30,
          outdated: false,
        },
      ]);

      const snippet = prompt.split("```diff\n")[1]!.split("\n```")[0]!.split("\n");
      expect(snippet).toEqual(body.slice(-SNIPPET_LINES));
    },
  );

  it("uses a longer fence when the snippet holds backticks", () => {
    const hunk = "@@ -1,2 +1,2 @@\n-const a = ```;\n+const a = '';";

    const prompt = buildAgentPrompt([
      { thread: thread({ comments: [comment("reviewer", "Hm", hunk)] }), line: 1, outdated: false },
    ]);

    expect(prompt).toContain("````diff\n@@ -1,2 +1,2 @@\n-const a = ```;\n+const a = '';\n````");
  });

  it("says when the line is unknown and when GitHub has more comments", () => {
    const prompt = buildAgentPrompt([
      {
        thread: thread({
          line: null,
          originalLine: null,
          outdated: true,
          hasMoreComments: true,
          comments: [comment("reviewer", "Hm")],
        }),
        line: null,
        outdated: true,
      },
    ]);

    expect(prompt).toContain("File: src/grid.ts, line unknown (outdated");
    expect(prompt).toContain("More comments on GitHub: https://github.com/o/r/pull/1#reviewer");
  });
});
