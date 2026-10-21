import { cliCommand, defineCli, PluginCliError, type PluginCliContext } from "@get-bb/plugin-sdk";
import type { ReadTextFileRequest, ReadTextFileResult } from "../contract";
import {
  formatReviewDrafts,
  formatReviewList,
  reviewCommentEntries,
  reviewListEntries,
} from "../core/review-list";
import { MAX_THREAD_PAGES, type ReviewThread } from "../core/review-threads";
import type { ThreadPlacement } from "../core/thread-placement";
import type { PrLoad, ReviewService } from "./review-service";

interface ReviewCliDeps {
  review: ReviewService;
  readTextFile(hostId: string, request: ReadTextFileRequest): Promise<ReadTextFileResult>;
  now(): number;
}

const bodyOptions = {
  body: { type: "string", placeholder: "text", description: "Draft text" },
  "body-file": {
    type: "string",
    placeholder: "path",
    description: "File with the draft text, max 64 KB, relative to the working directory",
  },
} as const;

const draftIdPositional = {
  name: "draft-id",
  description: "Comment draft id from `review list`",
  required: true,
} as const;

export function createReviewCli(deps: ReviewCliDeps) {
  function threadIdOf(ctx: PluginCliContext): string {
    if (ctx.threadId === undefined) {
      throw new PluginCliError("Not running in a bb thread", {
        hint: "Run this command from an agent in a bb thread.",
      });
    }
    return ctx.threadId;
  }

  function loaded<T>(load: PrLoad<T>, threadId: string) {
    if (load.kind === "no_pr") throw new PluginCliError("No pull request for this thread");
    if (load.kind === "error") throw new PluginCliError(load.message);
    return { ...load, threadId };
  }

  async function loadReview(ctx: PluginCliContext) {
    const threadId = threadIdOf(ctx);
    return loaded(await deps.review.load(threadId), threadId);
  }

  async function loadTarget(ctx: PluginCliContext) {
    const threadId = threadIdOf(ctx);
    return loaded(await deps.review.loadTarget(threadId), threadId);
  }

  async function readBody(
    hostId: string,
    options: { body?: string; "body-file"?: string },
    ctx: PluginCliContext,
  ) {
    const path = options["body-file"];
    if (path === undefined) return options.body ?? "";
    const result = await deps.readTextFile(hostId, { path, cwd: ctx.cwd ?? null });
    if (!result.ok) throw new PluginCliError(result.message);
    return result.text;
  }

  return defineCli({
    name: "github-insight",
    summary: "Review threads of this thread's pull request",
    commands: {
      "review list": cliCommand({
        summary:
          "List the unresolved review threads of this thread's PR, the comment drafts, and the summary draft",
        options: { json: { type: "boolean", description: "Print JSON" } },
        run: async ({ options }, ctx) => {
          const { review } = await loadReview(ctx);
          const threads = reviewListEntries(review.threads, review.drafts);
          const comments = reviewCommentEntries(review.commentDrafts);
          if (options.json) {
            const summary = review.summaryDraft?.body ?? null;
            return {
              exitCode: 0,
              stdout: `${JSON.stringify({ threads, comments, summary }, null, 2)}\n`,
            };
          }
          const drafts = formatReviewDrafts(comments, review.summaryDraft);
          return {
            exitCode: 0,
            stdout:
              drafts === "" ? formatReviewList(threads) : `${formatReviewList(threads)}\n${drafts}`,
          };
        },
      }),
      "review draft": cliCommand({
        summary: "Save a draft reply for a review thread. Never posts to GitHub.",
        positionals: [
          { name: "thread-id", description: "Review thread id from `review list`", required: true },
        ],
        options: bodyOptions,
        constraints: [{ kind: "exactly-one", options: ["body", "body-file"] }],
        run: async ({ positionals, options }, ctx) => {
          const reviewThreadId = positionals["thread-id"];
          const { threadId, target, allThreadsRead, review } = await loadReview(ctx);
          const thread = findThread(review.threads, reviewThreadId);
          if (thread === undefined) {
            throw new PluginCliError(`Unknown review thread: ${reviewThreadId}`, {
              hint: allThreadsRead
                ? "Run `bb github-insight review list` for the thread ids."
                : `Only the first ${MAX_THREAD_PAGES} pages of review threads were read.`,
            });
          }
          if (thread.resolved)
            throw new PluginCliError(`Review thread ${reviewThreadId} is resolved`);
          const body = await readBody(target.hostId, options, ctx);
          if (body.trim() === "") throw new PluginCliError("Draft is empty");
          await deps.review.saveDraft(threadId, target.ref, reviewThreadId, {
            body,
            updatedAt: deps.now(),
            source: "agent",
          });
          return { exitCode: 0, stdout: `Saved draft for ${reviewThreadId}\n` };
        },
      }),
      "review comment": cliCommand({
        summary: "Save a comment draft on a line of this thread's PR. Never posts to GitHub.",
        description:
          "Each call adds a new draft. Change or remove a draft with `review comment edit <draft-id>` or `review comment delete <draft-id>`.",
        positionals: [{ name: "path", description: "File path in the PR", required: true }],
        options: {
          line: {
            type: "integer",
            min: 1,
            max: Number.MAX_SAFE_INTEGER,
            required: true,
            description: "Line of the comment, or the last line of a range",
          },
          "start-line": {
            type: "integer",
            min: 1,
            max: Number.MAX_SAFE_INTEGER,
            description: "First line of a range. Every line of the range must be in the diff",
          },
          side: {
            type: "enum",
            values: ["RIGHT", "LEFT"],
            default: "RIGHT",
            description: "RIGHT for the new file, LEFT for the old file",
          },
          ...bodyOptions,
        },
        constraints: [{ kind: "exactly-one", options: ["body", "body-file"] }],
        run: async ({ positionals, options }, ctx) => {
          const { threadId, target, review } = await loadReview(ctx);
          const anchor = {
            path: positionals.path,
            side: options.side,
            line: options.line,
            startLine: options["start-line"] ?? null,
          } as const;
          const created = await deps.review.createCommentDraft(threadId, target.ref, review, {
            anchor,
            source: "agent",
            readBody: () => readBody(target.hostId, options, ctx),
          });
          if (created.kind === "error") {
            throw new PluginCliError(created.message, {
              hint:
                created.reason === "commit"
                  ? "Submit or delete those drafts first: in the Files sub-tab of the PR tab, or with `bb github-insight review comment delete <draft-id>`."
                  : undefined,
            });
          }
          return { exitCode: 0, stdout: `Saved comment draft ${created.draftId}\n` };
        },
      }),
      "review comment edit": cliCommand({
        summary:
          "Replace the text of a comment draft. Keeps its line and commit. Never posts to GitHub.",
        positionals: [draftIdPositional],
        options: bodyOptions,
        constraints: [{ kind: "exactly-one", options: ["body", "body-file"] }],
        run: async ({ positionals, options }, ctx) => {
          const draftId = positionals["draft-id"];
          const { threadId, target } = await loadTarget(ctx);
          const body = await readBody(target.hostId, options, ctx);
          if (body.trim() === "") throw new PluginCliError("Comment is empty");
          const edited = await deps.review.editCommentDraft(threadId, target.ref, draftId, {
            body,
            updatedAt: deps.now(),
            source: "agent",
          });
          if (!edited) throw unknownCommentDraft(draftId);
          return { exitCode: 0, stdout: `Updated comment draft ${draftId}\n` };
        },
      }),
      "review comment delete": cliCommand({
        summary: "Delete a comment draft. Never posts to GitHub.",
        positionals: [draftIdPositional],
        run: async ({ positionals }, ctx) => {
          const draftId = positionals["draft-id"];
          const { threadId, target } = await loadTarget(ctx);
          const deleted = await deps.review.deleteCommentDraft(threadId, target.ref, draftId);
          if (!deleted) throw unknownCommentDraft(draftId);
          return { exitCode: 0, stdout: `Deleted comment draft ${draftId}\n` };
        },
      }),
      "review summary": cliCommand({
        summary:
          "Save the review summary draft of this thread's PR. Replaces the old one. Never posts to GitHub.",
        options: bodyOptions,
        constraints: [{ kind: "exactly-one", options: ["body", "body-file"] }],
        run: async ({ options }, ctx) => {
          const { threadId, target } = await loadReview(ctx);
          const body = await readBody(target.hostId, options, ctx);
          if (body.trim() === "") throw new PluginCliError("Summary is empty");
          await deps.review.saveSummaryDraft(threadId, target.ref, {
            body,
            updatedAt: deps.now(),
            source: "agent",
          });
          return { exitCode: 0, stdout: "Saved summary draft\n" };
        },
      }),
    },
  });
}

function unknownCommentDraft(draftId: string) {
  return new PluginCliError(`Unknown comment draft: ${draftId}`, {
    hint: "Run `bb github-insight review list` for the draft ids.",
  });
}

function findThread(placement: ThreadPlacement, id: string): ReviewThread | undefined {
  return (
    placement.placed.find(({ thread }) => thread.id === id)?.thread ??
    placement.outdated.find((thread) => thread.id === id)
  );
}
