import { isReviewed } from "../core/review-queue-view";
import type {
  ActionResult,
  InsightResult,
  LinkedQueuePr,
  LoadedReviewQueue,
  QueueSection,
  ReviewQueueResult,
  ReviewQueueView,
} from "../contract";

export function queuePr(overrides: Partial<LinkedQueuePr> = {}): LinkedQueuePr {
  return {
    repo: "acme/api",
    number: 15,
    title: "Add rate limits",
    author: "alice",
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    updatedAt: new Date().toISOString(),
    draft: false,
    ci: "passed",
    reviewDecision: "REVIEW_REQUIRED",
    headRefName: "rate-limits",
    headOid: "head-15",
    url: "https://github.com/acme/api/pull/15",
    state: "open",
    closedAt: null,
    activity: null,
    requested: true,
    projectIds: ["prj_api", "prj_api_old"],
    review: "needs_review",
    newActivity: [],
    thread: null,
    ...overrides,
  };
}

export function section(prs: LinkedQueuePr[]): QueueSection {
  return [...new Set(prs.map((pr) => pr.repo))].map((repo) => ({
    repo,
    prs: prs.filter((pr) => pr.repo === repo),
  }));
}

const LOADED_AT = Date.parse("2026-10-02T09:30:00Z");

export function view(prs: LinkedQueuePr[], truncated = false): ReviewQueueView {
  return {
    needsReview: section(prs.filter((pr) => !isReviewed(pr))),
    reviewed: section(prs.filter(isReviewed)),
    truncated,
    loadedAt: LOADED_AT,
    hasUnseen: false,
    hasReturned: false,
  };
}

export const reviewThread = {
  id: "thr_review",
  status: "running",
  isReviewThread: true,
  returned: null,
} as const;

export function ok(queueView: ReviewQueueView): LoadedReviewQueue {
  return { kind: "ok", ...queueView };
}

export const unusedRpc = {
  getInsight: () => ({ kind: "no_pr" as const }),
  refresh: () => ({ kind: "no_pr" as const }),
  getPrVideo: () => ({ kind: "error" as const, code: "read" as const, message: "unavailable" }),
  getPrImage: () => ({ kind: "error" as const, code: "read" as const, message: "unavailable" }),
  getReview: () => ({ kind: "no_pr" as const }),
  getDrafts: () => ({ kind: "no_pr" as const }),
  getTimeline: () => ({ kind: "no_pr" as const }),
  addPrComment: () => ({ kind: "error" as const, message: "unused" }),
  sendToAgent: () => ({ kind: "error" as const, message: "unused" }),
  reply: () => ({ kind: "post_failed" as const, message: "unused" }),
  setResolved: () => ({ kind: "error" as const, message: "unused" }),
  saveDraft: () => ({ kind: "error" as const, message: "unused" }),
  discardDraft: () => ({ kind: "error" as const, message: "unused" }),
  createCommentDraft: () => ({ kind: "error" as const, message: "unused" }),
  saveCommentDraft: () => ({ kind: "error" as const, message: "unused" }),
  deleteCommentDraft: () => ({ kind: "error" as const, message: "unused" }),
  saveSummaryDraft: () => ({ kind: "error" as const, message: "unused" }),
  updateViewed: () => ({ kind: "error" as const, message: "unused" }),
  markCommentsSeen: () => ({ kind: "error" as const, message: "unused" }),
  submitReview: () => ({ kind: "error" as const, message: "unused", url: null }),
  runPrAction: () => ({ kind: "error" as const, message: "unused" }),
  localCommitsAhead: () => ({ kind: "unknown" as const }),
  getPrInsight: () => ({ kind: "no_pr" as const }),
  refreshPrInsight: () => ({ kind: "no_pr" as const }),
};

export type QueueHandler = () => ReviewQueueResult | Promise<ReviewQueueResult>;

export interface PanelRpc {
  refreshReviewQueue: () => LoadedReviewQueue | Promise<LoadedReviewQueue>;
  startReview: () => { threadId: string } | Promise<{ threadId: string }>;
  getPrimaryHost: () => { hostId: string | null } | Promise<{ hostId: string | null }>;
  archiveReview: () => ActionResult | Promise<ActionResult>;
  markReviewed: () => ActionResult | Promise<ActionResult>;
  markNeedsReview: () => ActionResult | Promise<ActionResult>;
  markQueueSeen: () => ActionResult | Promise<ActionResult>;
  markThreadOpened: () => ActionResult | Promise<ActionResult>;
  getPrInsight: () => InsightResult | Promise<InsightResult>;
  refreshPrInsight: () => InsightResult | Promise<InsightResult>;
}

export function panelRpc(getReviewQueue: QueueHandler, rpc: Partial<PanelRpc> = {}) {
  return {
    ...unusedRpc,
    getReviewQueue,
    refreshReviewQueue: async () => {
      const result = await getReviewQueue();
      if (result.kind === "loading") throw new Error("unexpected loading");
      return result;
    },
    startReview: () => ({ threadId: "thr_new" }),
    getPrimaryHost: () => ({ hostId: "host-1" }),
    archiveReview: () => ({ kind: "ok" as const }),
    markReviewed: () => ({ kind: "ok" as const }),
    markNeedsReview: () => ({ kind: "ok" as const }),
    markQueueSeen: () => ({ kind: "ok" as const }),
    markThreadOpened: () => ({ kind: "ok" as const }),
    ...rpc,
  };
}
