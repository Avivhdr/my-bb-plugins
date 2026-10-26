import { isReviewed } from "../core/review-queue-view";
import type {
  ActionResult,
  InsightResult,
  LinkedQueuePr,
  LoadedReviewQueue,
  QueueSection,
  ReviewQueueResult,
  ReviewQueueView,
  ActivityResult,
  ActivityViewItem,
  ActivityViewPr,
  LoadedActivity,
  ReviewInstructions,
  ViewerTeamsResult,
} from "../contract";
import { DEFAULT_REVIEW_INSTRUCTIONS } from "../core/review-prompt";

export function queuePr(overrides: Partial<LinkedQueuePr> = {}): LinkedQueuePr {
  return {
    repo: "acme/api",
    number: 15,
    title: "Add rate limits",
    author: "alice",
    authorAvatarUrl: null,
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
    labels: [],
    activity: null,
    layer: "Direct",
    projectIds: ["prj_api", "prj_api_old"],
    review: "needs_review",
    newActivity: [],
    thread: null,
    skipLabel: null,
    ignored: false,
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

export const LAYERS = [
  { name: "Direct", teammates: null },
  { name: "Teammates", teammates: "only" },
  { name: "Team", teammates: "exclude" },
] as const;

/** Sorts PRs the way the service does: merged, ignored, reviewed, then each PR's layer. */
export function view(prs: LinkedQueuePr[], truncated = false): ReviewQueueView {
  const open = prs.filter((pr) => pr.state === "open" && !pr.ignored);
  const waiting = open.filter((pr) => !isReviewed(pr) && pr.layer !== null);
  return {
    layers: LAYERS.map(({ name, teammates }) => {
      const layerPrs = waiting.filter((pr) => pr.layer === name);
      return {
        name,
        prs: section(layerPrs),
        count: layerPrs.filter((pr) => pr.skipLabel === null).length,
        truncated: truncated && name === "Direct",
        hiddenRepos: [],
        teammates,
      };
    }),
    reviewed: section(open.filter((pr) => isReviewed(pr) || pr.layer === null)),
    merged: section(prs.filter((pr) => pr.state !== "open")),
    ignored: section(prs.filter((pr) => pr.state === "open" && pr.ignored)),
    hiddenEverywhere: [],
    teammatesTeam: null,
    teammatesError: null,
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
  hideRepo: () => ActionResult | Promise<ActionResult>;
  showRepo: () => ActionResult | Promise<ActionResult>;
  ignorePr: () => ActionResult | Promise<ActionResult>;
  unignorePr: () => ActionResult | Promise<ActionResult>;
  getViewerTeams: () => ViewerTeamsResult | Promise<ViewerTeamsResult>;
  setTeammatesTeam: () => ActionResult | Promise<ActionResult>;
  getReviewInstructions: () => ReviewInstructions | Promise<ReviewInstructions>;
  setReviewInstructions: () => ActionResult | Promise<ActionResult>;
  getActivity: () => ActivityResult | Promise<ActivityResult>;
  refreshActivity: () => LoadedActivity | Promise<LoadedActivity>;
  markActivityRead: () => ActionResult | Promise<ActionResult>;
  markActivityPrRead: () => ActionResult | Promise<ActionResult>;
  markAllActivityRead: () => ActionResult | Promise<ActionResult>;
  setActivityMuted: () => ActionResult | Promise<ActionResult>;
  getPrInsight: () => InsightResult | Promise<InsightResult>;
  getInsight: () => InsightResult | Promise<InsightResult>;
  refresh: () => InsightResult | Promise<InsightResult>;
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
    hideRepo: () => ({ kind: "ok" as const }),
    showRepo: () => ({ kind: "ok" as const }),
    ignorePr: () => ({ kind: "ok" as const }),
    unignorePr: () => ({ kind: "ok" as const }),
    getViewerTeams: () => ({ kind: "ok" as const, teams: [] }),
    setTeammatesTeam: () => ({ kind: "ok" as const }),
    getReviewInstructions: () => ({ instructions: DEFAULT_REVIEW_INSTRUCTIONS, isDefault: true }),
    setReviewInstructions: () => ({ kind: "ok" as const }),
    getActivity: () => ({ kind: "loading" as const }),
    refreshActivity: () => ({ kind: "error" as const, message: "unused", lastGood: null }),
    markActivityRead: () => ({ kind: "ok" as const }),
    markActivityPrRead: () => ({ kind: "ok" as const }),
    markAllActivityRead: () => ({ kind: "ok" as const }),
    setActivityMuted: () => ({ kind: "ok" as const }),
    ...rpc,
  };
}

export function activityItem(overrides: Partial<ActivityViewItem> = {}): ActivityViewItem {
  return {
    id: "C1",
    repo: "acme/api",
    number: 7,
    kind: "comment",
    team: null,
    actor: "bob",
    actorAvatarUrl: null,
    snippet: "Why a retry here?",
    at: new Date(Date.now() - 3_600_000).toISOString(),
    url: "https://github.com/acme/api/pull/7#issuecomment-1",
    place: "conversation",
    read: false,
    ...overrides,
  };
}

export function activityPr(items: ActivityViewItem[], overrides: Partial<ActivityViewPr> = {}) {
  return {
    repo: "acme/api",
    number: 7,
    title: "Add retries",
    url: "https://github.com/acme/api/pull/7",
    state: "open" as const,
    mine: true,
    items,
    unread: items.filter((item) => !item.read).length,
    ...overrides,
  };
}

export function activityOk(prs: ActivityViewPr[], muted: string[] = []): LoadedActivity {
  return {
    kind: "ok",
    prs,
    unread: prs.reduce((sum, pr) => sum + pr.unread, 0),
    muted,
    loadedAt: Date.parse("2026-10-02T09:30:00Z"),
  };
}
