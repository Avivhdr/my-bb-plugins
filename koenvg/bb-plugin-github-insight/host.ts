import { readPrVideo } from "./github/pr-video-content";
import { imageMergeBaseArgs, readPrImage } from "./github/pr-image-content";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract, type GhResult } from "./contract";
import {
  disableAutoMergeArgs,
  enableAutoMergeArgs,
  updatePullRequestBranchArgs,
} from "./github/branch-mutations";
import { checkRunDetailsArgs } from "./github/check-run-details-query";
import { addCommentArgs } from "./github/comment-mutation";
import {
  classifyGhFailure,
  isGithubTimeout,
  parseGraphqlRateLimitReset,
  RATE_LIMIT_ARGS,
  type GhProcessError,
} from "./github/gh-failure";
import { enqueuePullRequestArgs, mergePullRequestArgs } from "./github/merge-mutations";
import { readNotFoundPartial } from "./github/not-found-partial";
import { overviewPageArgs } from "./github/overview-query";
import { fitPrFilesPage, prFilesPageArgs } from "./github/pr-files-query";
import { prHeadArgs } from "./github/pr-head-query";
import { reviewQueueBatchArgs } from "./github/review-queue-query";
import { ADD_REVIEW_ARGS, addPullRequestReviewInput } from "./github/review-mutations";
import { teamPrPageArgs, VIEWER_TEAMS_ARGS } from "./github/team-prs-query";
import { replyToThreadArgs, setThreadResolvedArgs } from "./github/review-thread-mutations";
import { reviewThreadsPageArgs } from "./github/review-threads-query";
import { timelinePageArgs } from "./github/timeline-query";
import { countLocalCommitsAhead } from "./local-commits";
import { readTextFile } from "./read-text-file";

const execFileAsync = promisify(execFile);

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    readPrVideo: (request, context) => readPrVideo(request, context.signal),
    readPrImage: (request, context) => readPrImage(request, context.signal),
    fetchImageMergeBase: (request, context) =>
      runGhJson(imageMergeBaseArgs(request), context.signal),
    fetchOverviewPage: (request, context) => runGhJson(overviewPageArgs(request), context.signal),
    fetchCheckRunDetails: (request, context) =>
      runGhJson(checkRunDetailsArgs(request), context.signal),
    fetchPrFiles: async (request, context): Promise<GhResult> => {
      const result = await runGhJson(prFilesPageArgs(request), context.signal);
      return result.ok ? { ok: true, data: fitPrFilesPage(result.data) } : result;
    },
    fetchReviewThreads: (request, context) =>
      runGhJson(reviewThreadsPageArgs(request), context.signal),
    fetchPrHead: (request, context) => runGhJson(prHeadArgs(request), context.signal),
    fetchTimeline: (request, context) => runGhJson(timelinePageArgs(request), context.signal),
    addComment: (request, context) => runGhJson(addCommentArgs(request), context.signal),
    readTextFile: (request) => readTextFile(request),
    countLocalCommitsAhead: (request) => countLocalCommitsAhead(request),
    replyToThread: (request, context) => runGhJson(replyToThreadArgs(request), context.signal),
    setThreadResolved: (request, context) =>
      runGhJson(setThreadResolvedArgs(request), context.signal),
    fetchReviewQueue: ({ tracked }, context) =>
      fetchReviewQueue(reviewQueueBatchArgs(tracked), context.signal),
    fetchViewerTeams: (_request, context) => runGhJson(VIEWER_TEAMS_ARGS, context.signal),
    fetchTeamPrPage: (request, context) => runGhJson(teamPrPageArgs(request), context.signal),
    mergePullRequest: (request, context) =>
      runGhJson(mergePullRequestArgs(request), context.signal),
    enqueuePullRequest: (request, context) =>
      runGhJson(enqueuePullRequestArgs(request), context.signal),
    updatePullRequestBranch: (request, context) =>
      runGhJson(updatePullRequestBranchArgs(request), context.signal),
    enablePullRequestAutoMerge: (request, context) =>
      runGhJson(enableAutoMergeArgs(request), context.signal),
    disablePullRequestAutoMerge: (request, context) =>
      runGhJson(disableAutoMergeArgs(request), context.signal),
    submitReview: (request, context) =>
      runGhJson(ADD_REVIEW_ARGS, context.signal, addPullRequestReviewInput(request)),
    readRateLimitReset: async (_request, context) => ({
      resetAt: await readRateLimitReset(context.signal),
    }),
  },
});

async function gh(args: string[], signal: AbortSignal, stdin?: string): Promise<unknown> {
  const run = execFileAsync("gh", args, {
    signal,
    maxBuffer: 64 * 1024 * 1024,
  });
  run.child.stdin?.end(stdin);
  const { stdout } = await run;
  return JSON.parse(stdout) as unknown;
}

async function fetchReviewQueue(batches: string[][], signal: AbortSignal): Promise<GhResult> {
  const results = await Promise.all(batches.map((args) => runGhJsonRetryingTimeout(args, signal)));
  const failures = results.filter((result) => !result.ok);
  const failure = failures.find(({ failure }) => failure.kind !== "failed") ?? failures[0];
  if (failure !== undefined) return failure;
  return { ok: true, data: results.filter((result) => result.ok).map(({ data }) => data) };
}

async function runGhJsonRetryingTimeout(args: string[], signal: AbortSignal): Promise<GhResult> {
  const result = await runGhJsonAllowingNotFound(args, signal);
  return !result.ok && isGithubTimeout(result.failure)
    ? runGhJsonAllowingNotFound(args, signal)
    : result;
}

// gh exits non-zero when GitHub returns data with errors, e.g. a tracked PR that no longer exists.
async function runGhJsonAllowingNotFound(args: string[], signal: AbortSignal): Promise<GhResult> {
  try {
    return { ok: true, data: await gh(args, signal) };
  } catch (error) {
    const partial = readNotFoundPartial(stdoutOf(error));
    return partial !== null ? { ok: true, data: partial } : ghFailureResult(error, signal);
  }
}

async function runGhJson(args: string[], signal: AbortSignal, stdin?: string): Promise<GhResult> {
  try {
    return { ok: true, data: await gh(args, signal, stdin) };
  } catch (error) {
    return ghFailureResult(error, signal);
  }
}

async function ghFailureResult(error: unknown, signal: AbortSignal): Promise<GhResult> {
  const failure = classifyGhFailure(processError(error));
  if (failure.kind !== "rate_limited") return { ok: false, failure };
  return {
    ok: false,
    failure: { ...failure, resetAt: await readRateLimitReset(signal) },
  };
}

// GitHub does not count `gh api rate_limit` against the rate limit.
async function readRateLimitReset(signal: AbortSignal): Promise<number | null> {
  try {
    return parseGraphqlRateLimitReset(await gh(RATE_LIMIT_ARGS, signal));
  } catch {
    return null;
  }
}

function stdoutOf(error: unknown): string {
  return typeof error === "object" && error !== null && "stdout" in error
    ? String(error.stdout)
    : "";
}

function processError(error: unknown): GhProcessError {
  const fields = typeof error === "object" && error !== null ? error : {};
  const code = "code" in fields ? fields.code : undefined;
  return {
    code: typeof code === "string" || typeof code === "number" ? code : undefined,
    stderr: "stderr" in fields ? String(fields.stderr) : "",
    message: error instanceof Error ? error.message : String(error),
  };
}
