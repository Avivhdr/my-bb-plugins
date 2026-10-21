import type {
  ActionResult,
  AddPullRequestReviewRequest,
  CreateCommentDraftRequest,
  CreateCommentDraftResult,
  DeleteCommentDraftRequest,
  DiscardDraftRequest,
  ReplyRequest,
  ReplyResult,
  SaveCommentDraftRequest,
  SaveDraftRequest,
  SaveSummaryDraftRequest,
  SetResolvedRequest,
  SubmitReviewRequest,
  SubmitReviewResult,
} from "../contract";
import { draftsCommit } from "../core/draft-commits";
import { pullRequestUrl, type PullRequestRef } from "../core/pr-ref";
import { hasText } from "../core/review-drafts";
import { closedReason, submitRules, type ReviewEvent } from "../core/review-submit";
import type { ReviewUpdated } from "../core/review-updated";
import { write, type Written } from "../github/gh-write";
import { submitReviewError } from "../github/review-mutations";
import { isPendingReply } from "../github/review-thread-mutations";
import { RECHECK_NO_PR, type LookupOptions, type PrResolution, type PrTarget } from "../pr-lookup";
import type { DraftStore } from "./draft-store";
import type { BasisLoad, PrReview, ReviewLoad, ReviewService } from "./review-service";

interface ReviewWritesDeps {
  resolvePr(threadId: string, options?: LookupOptions): Promise<PrResolution>;
  replyToThread(target: PrTarget, reviewThreadId: string, body: string): Promise<unknown>;
  setThreadResolved(target: PrTarget, reviewThreadId: string, resolved: boolean): Promise<unknown>;
  loadReview(threadId: string): Promise<ReviewLoad>;
  loadBasis(threadId: string): Promise<BasisLoad>;
  submitReview(target: PrTarget, request: AddPullRequestReviewRequest): Promise<unknown>;
  drafts: DraftStore;
  publish(update: ReviewUpdated): void;
  publishDrafts(update: ReviewUpdated): void;
  refreshAfterWrite(threadId: string): Promise<void>;
  markReviewed(ref: PullRequestRef, commitOid: string): Promise<ActionResult>;
  now(): number;
  createLocalCommentDraft: ReviewService["createCommentDraft"];
  warn(message: string): void;
}

const NO_PR_MESSAGE = "No pull request for this thread";
const OWN_PR_MESSAGE = "On your own pull request you can only comment";

function reviewInput(
  { head, commentDrafts }: PrReview,
  event: ReviewEvent,
  body: string,
): Written<AddPullRequestReviewRequest> {
  const { viewerIsAuthor, state } = head;
  const comments = commentDrafts.filter((draft) => hasText(draft.body));
  const rule = submitRules({
    viewerIsAuthor,
    state,
    body,
    commentCount: comments.length,
  }).find((candidate) => candidate.event === event);
  if (rule === undefined) return { ok: false, message: OWN_PR_MESSAGE };
  if (rule.disabledReason !== null) return { ok: false, message: rule.disabledReason };
  const commit = draftsCommit(commentDrafts, head.oid);
  if (!commit.ok) return commit;
  return {
    ok: true,
    value: {
      pullRequestId: head.prNodeId,
      commitOid: commit.value,
      event,
      body,
      threads: comments.map(({ path, side, line, startLine, body }) => ({
        path,
        side,
        line,
        startLine,
        body,
      })),
    },
  };
}

export function createReviewWrites(deps: ReviewWritesDeps) {
  async function targetOf(threadId: string): Promise<Written<PrTarget>> {
    const resolution = await deps.resolvePr(threadId, RECHECK_NO_PR);
    if (resolution.kind === "pr") return { ok: true, value: resolution.target };
    return { ok: false, message: resolution.kind === "error" ? resolution.message : NO_PR_MESSAGE };
  }

  async function refreshAfterWrite(threadId: string) {
    await deps.refreshAfterWrite(threadId).catch((error: unknown) => {
      deps.warn(`Could not refresh the PR insight of thread ${threadId}: ${String(error)}`);
    });
  }

  async function reply({
    threadId,
    reviewThreadId,
    body,
    resolve,
  }: ReplyRequest): Promise<ReplyResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "post_failed", message: target.message };
    const posted = await write(() => deps.replyToThread(target.value, reviewThreadId, body));
    if (!posted.ok) return { kind: "post_failed", message: posted.message };
    await deps.drafts.delete(target.value.ref, reviewThreadId).catch((error: unknown) => {
      deps.warn(
        `Posted a reply to ${reviewThreadId}, but could not delete its draft: ${String(error)}`,
      );
    });
    const pendingReviewUrl = isPendingReply(posted.value) ? pullRequestUrl(target.value.ref) : null;
    if (!resolve) return { kind: "posted", pendingReviewUrl, resolveError: null };
    const resolved = await write(() => deps.setThreadResolved(target.value, reviewThreadId, true));
    if (resolved.ok) await refreshAfterWrite(threadId);
    return {
      kind: "posted",
      pendingReviewUrl,
      resolveError: resolved.ok ? null : resolved.message,
    };
  }

  async function setResolved({
    threadId,
    reviewThreadId,
    resolved,
  }: SetResolvedRequest): Promise<ActionResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "error", message: target.message };
    const written = await write(() =>
      deps.setThreadResolved(target.value, reviewThreadId, resolved),
    );
    if (written.ok) await refreshAfterWrite(threadId);
    return written.ok ? { kind: "ok" } : { kind: "error", message: written.message };
  }

  async function saveDraft({
    threadId,
    reviewThreadId,
    body,
  }: SaveDraftRequest): Promise<ActionResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "error", message: target.message };
    await deps.drafts.save(target.value.ref, reviewThreadId, {
      body,
      updatedAt: deps.now(),
      source: "user",
    });
    return { kind: "ok" };
  }

  async function discardDraft({
    threadId,
    reviewThreadId,
  }: DiscardDraftRequest): Promise<ActionResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "error", message: target.message };
    await deps.drafts.delete(target.value.ref, reviewThreadId);
    deps.publishDrafts({ threadId });
    return { kind: "ok" };
  }

  async function createCommentDraft({
    threadId,
    path,
    side,
    line,
  }: CreateCommentDraftRequest): Promise<CreateCommentDraftResult> {
    const loaded = await deps.loadBasis(threadId);
    if (loaded.kind !== "ok") {
      return { kind: "error", message: loaded.kind === "error" ? loaded.message : NO_PR_MESSAGE };
    }
    const { basis, target } = loaded;
    const closed = closedReason(basis.head.state);
    if (closed !== null) return { kind: "error", message: closed };
    const created = await deps.createLocalCommentDraft(threadId, target.ref, basis, {
      anchor: { path, side, line, startLine: null },
      source: "user",
    });
    return created.kind === "error" ? { kind: "error", message: created.message } : created;
  }

  async function saveCommentDraft({
    threadId,
    draftId,
    body,
  }: SaveCommentDraftRequest): Promise<ActionResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "error", message: target.message };
    const edited = await deps.drafts.editComment(target.value.ref, draftId, {
      body,
      updatedAt: deps.now(),
      source: "user",
    });
    return edited ? { kind: "ok" } : { kind: "error", message: `Comment draft ${draftId} is gone` };
  }

  async function deleteCommentDraft({
    threadId,
    draftId,
  }: DeleteCommentDraftRequest): Promise<ActionResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "error", message: target.message };
    await deps.drafts.deleteComment(target.value.ref, draftId);
    deps.publishDrafts({ threadId });
    return { kind: "ok" };
  }

  async function saveSummaryDraft({
    threadId,
    body,
  }: SaveSummaryDraftRequest): Promise<ActionResult> {
    const target = await targetOf(threadId);
    if (!target.ok) return { kind: "error", message: target.message };
    await deps.drafts.saveSummary(target.value.ref, {
      body,
      updatedAt: deps.now(),
      source: "user",
    });
    return { kind: "ok" };
  }

  async function submitReview({
    threadId,
    event,
    body,
  }: SubmitReviewRequest): Promise<SubmitReviewResult> {
    const loaded = await deps.loadReview(threadId);
    if (loaded.kind !== "ok") {
      return {
        kind: "error",
        message: loaded.kind === "error" ? loaded.message : NO_PR_MESSAGE,
        url: null,
      };
    }
    const input = reviewInput(loaded.review, event, body);
    if (!input.ok) return { kind: "error", message: input.message, url: null };
    const { ref } = loaded.target;
    const submitted = await write(() => deps.submitReview(loaded.target, input.value));
    if (!submitted.ok)
      return { kind: "error", ...submitReviewError(submitted.message, pullRequestUrl(ref)) };
    await deps.drafts.deleteReviewDrafts(ref).catch((error: unknown) => {
      deps.warn(
        `Submitted a review on thread ${threadId}, but could not delete its drafts: ${String(error)}`,
      );
    });
    deps.publish({ threadId });
    await refreshAfterWrite(threadId);
    if (loaded.review.head.viewerIsAuthor) return { kind: "submitted" };
    const marked = await deps.markReviewed(ref, input.value.commitOid);
    return marked.kind === "error"
      ? { kind: "submitted", markError: marked.message }
      : { kind: "submitted" };
  }

  return {
    reply,
    setResolved,
    saveDraft,
    discardDraft,
    createCommentDraft,
    saveCommentDraft,
    deleteCommentDraft,
    saveSummaryDraft,
    submitReview,
  };
}
