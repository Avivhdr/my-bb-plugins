import type {
  ActionResult,
  DisableAutoMergeRequest,
  EnableAutoMergeRequest,
  EnqueuePullRequestRequest,
  MergePullRequestRequest,
  RunPrActionRequest,
  UpdatePullRequestBranchRequest,
} from "../contract";
import { write, type Written } from "../github/gh-write";
import type { CachedPr } from "../refresh/insight-service";
import type { PrTarget } from "../pr-lookup";

interface PrWritesDeps {
  cachedPr(threadId: string): Promise<CachedPr>;
  mergePullRequest(target: PrTarget, request: MergePullRequestRequest): Promise<unknown>;
  enqueuePullRequest(target: PrTarget, request: EnqueuePullRequestRequest): Promise<unknown>;
  updatePullRequestBranch(
    target: PrTarget,
    request: UpdatePullRequestBranchRequest,
  ): Promise<unknown>;
  enablePullRequestAutoMerge(target: PrTarget, request: EnableAutoMergeRequest): Promise<unknown>;
  disablePullRequestAutoMerge(target: PrTarget, request: DisableAutoMergeRequest): Promise<unknown>;
  refreshAfterWrite(threadId: string): Promise<void>;
  warn(message: string): void;
}

type GitHubWrite = (deps: PrWritesDeps) => Promise<unknown>;

const NO_PR_MESSAGE = "No pull request for this thread";
const NOT_READ_MESSAGE = "Refresh the PR and try again.";
const STALE: Written<never> = { ok: false, message: "The PR changed. Refresh and try again." };

type Cached = Extract<CachedPr, { kind: "cached" }>;

function writeFor(cached: Cached, request: RunPrActionRequest): GitHubWrite | null {
  const { target, pullRequestId, insight } = cached;
  const { expectedHeadOid } = request;
  const { mergeAction, autoMergeAction } = insight;
  switch (request.action) {
    case "merge":
      return mergeAction.kind === "merge"
        ? (deps) =>
            deps.mergePullRequest(target, {
              pullRequestId,
              mergeMethod: mergeAction.method,
              expectedHeadOid,
            })
        : null;
    case "enqueue":
      return mergeAction.kind === "enqueue"
        ? (deps) => deps.enqueuePullRequest(target, { pullRequestId, expectedHeadOid })
        : null;
    case "update-merge":
    case "update-rebase": {
      const updateMethod = request.action === "update-merge" ? "MERGE" : "REBASE";
      return insight.canUpdateBranch
        ? (deps) =>
            deps.updatePullRequestBranch(target, { pullRequestId, expectedHeadOid, updateMethod })
        : null;
    }
    case "enable-auto-merge":
      return autoMergeAction.kind === "enable"
        ? (deps) =>
            deps.enablePullRequestAutoMerge(target, {
              pullRequestId,
              mergeMethod: autoMergeAction.method,
              expectedHeadOid,
            })
        : null;
    case "disable-auto-merge":
      return autoMergeAction.kind === "disable"
        ? (deps) => deps.disablePullRequestAutoMerge(target, { pullRequestId })
        : null;
  }
}

function gitHubWriteOf(cached: CachedPr, request: RunPrActionRequest): Written<GitHubWrite> {
  if (cached.kind === "no_pr") return { ok: false, message: NO_PR_MESSAGE };
  if (cached.kind === "error") return { ok: false, message: cached.message };
  if (cached.kind === "not_cached") return { ok: false, message: NOT_READ_MESSAGE };
  const headGuarded = request.action !== "disable-auto-merge";
  if (headGuarded && cached.insight.pr.headOid !== request.expectedHeadOid) return STALE;
  const send = writeFor(cached, request);
  return send === null ? STALE : { ok: true, value: send };
}

export function createPrWrites(deps: PrWritesDeps) {
  async function runPrAction(request: RunPrActionRequest): Promise<ActionResult> {
    const call = gitHubWriteOf(await deps.cachedPr(request.threadId), request);
    if (!call.ok) return { kind: "error", message: call.message };
    const written = await write(() => call.value(deps));
    if (!written.ok) return { kind: "error", message: written.message };
    await deps.refreshAfterWrite(request.threadId).catch((error: unknown) => {
      deps.warn(`Could not refresh the PR insight of thread ${request.threadId}: ${String(error)}`);
    });
    return { kind: "ok" };
  }

  return { runPrAction };
}
