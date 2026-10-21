import { videoResultSchema } from "./core/video-content";
import {
  imagePathSchema,
  imageShaSchema,
  imageSideSchema,
  imageResultSchema,
} from "./core/image-content";
import { imageRepoSchema, prImageRefsSchema, prImageBasisSchema } from "./core/pr-image-basis";
export const prImageRequestSchema = imageRepoSchema
  .extend({ sha: imageShaSchema, path: imagePathSchema })
  .strict();
import { defineRpcContract, type NewThreadRequest } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { draftsSchema } from "./core/drafts";
import { mergeMethodSchema } from "./core/merge-action";
import { prInsightSchema } from "./core/overview";
import { reviewFileSchema } from "./core/pr-files";
import { viewedMarksSchema } from "./core/viewed-marks";
import { prHeadSchema } from "./core/pr-head";
import {
  commentDraftSchema,
  listedCommentDraftSchema,
  summaryDraftSchema,
} from "./core/review-drafts";
import { reviewPrSchema } from "./core/review-pr";
import { reviewEventSchema } from "./core/review-submit";
import { loadedReviewQueueSchema, reviewQueueResultSchema } from "./core/review-queue-view";
import { threadPlacementSchema } from "./core/thread-placement";
import { prDescriptionSchema, timelineEventSchema } from "./core/timeline";
import { ghFailureSchema } from "./github/gh-failure";

export type {
  LinkedQueuePr,
  LinkedThread,
  LoadedReviewQueue,
  NewActivity,
  QueueSection,
  ReviewQueueResult,
  ReviewQueueView,
  ReviewThreadStatus,
  ReturnedReason,
} from "./core/review-queue-view";

const prRequestFields = {
  owner: z.string().min(1),
  repo: z.string().min(1),
  number: z.number().int().positive(),
};

const prPageRequestSchema = z.object({ ...prRequestFields, after: z.string().nullable() }).strict();
export type PrPageRequest = z.infer<typeof prPageRequestSchema>;

const timelinePageRequestSchema = z
  .object({ ...prRequestFields, before: z.string().nullable() })
  .strict();
export type TimelinePageRequest = z.infer<typeof timelinePageRequestSchema>;

const teamPrPageRequestSchema = z
  .object({
    repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
    since: z.string().datetime(),
    after: z.string().nullable(),
  })
  .strict();
export type TeamPrPageRequest = z.infer<typeof teamPrPageRequestSchema>;

const addCommentRequestSchema = z
  .object({ subjectId: z.string().min(1), body: z.string().regex(/\S/) })
  .strict();
export type AddCommentRequest = z.infer<typeof addCommentRequestSchema>;

const checkRunDetailsRequestSchema = z.object({ ids: z.array(z.string().min(1)).min(1) }).strict();
export type CheckRunDetailsRequest = z.infer<typeof checkRunDetailsRequestSchema>;

const prFilesRequestSchema = z.object(prRequestFields).strict();
export type PrFilesRequest = z.infer<typeof prFilesRequestSchema>;

const prFilesPageRequestSchema = z
  .object({ ...prRequestFields, page: z.number().int().positive() })
  .strict();
export type PrFilesPageRequest = z.infer<typeof prFilesPageRequestSchema>;

const ghResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({ ok: z.literal(false), failure: ghFailureSchema }),
]);
export type GhResult = z.infer<typeof ghResultSchema>;

const readTextFileRequestSchema = z
  .object({ path: z.string().min(1), cwd: z.string().nullable() })
  .strict();
export type ReadTextFileRequest = z.infer<typeof readTextFileRequestSchema>;

const readTextFileResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);
export type ReadTextFileResult = z.infer<typeof readTextFileResultSchema>;

const localCommitsRequestSchema = z
  .object({ path: z.string().min(1), branch: z.string().min(1) })
  .strict();
export type LocalCommitsRequest = z.infer<typeof localCommitsRequestSchema>;

const localCommitsAheadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("count"), count: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("unknown") }),
]);
export type LocalCommitsAhead = z.infer<typeof localCommitsAheadSchema>;

const replyToThreadRequestSchema = z
  .object({ threadId: z.string().min(1), body: z.string().min(1) })
  .strict();
export type ReplyToThreadRequest = z.infer<typeof replyToThreadRequestSchema>;

const setThreadResolvedRequestSchema = z
  .object({ threadId: z.string().min(1), resolved: z.boolean() })
  .strict();
export type SetThreadResolvedRequest = z.infer<typeof setThreadResolvedRequestSchema>;

const mergePullRequestRequestSchema = z
  .object({
    pullRequestId: z.string().min(1),
    mergeMethod: mergeMethodSchema,
    expectedHeadOid: z.string().min(1),
  })
  .strict();
export type MergePullRequestRequest = z.infer<typeof mergePullRequestRequestSchema>;

const enqueuePullRequestRequestSchema = mergePullRequestRequestSchema.omit({ mergeMethod: true });
export type EnqueuePullRequestRequest = z.infer<typeof enqueuePullRequestRequestSchema>;

const updatePullRequestBranchRequestSchema = enqueuePullRequestRequestSchema
  .extend({ updateMethod: z.enum(["MERGE", "REBASE"]) })
  .strict();
export type UpdatePullRequestBranchRequest = z.infer<typeof updatePullRequestBranchRequestSchema>;

const enableAutoMergeRequestSchema = mergePullRequestRequestSchema;
export type EnableAutoMergeRequest = z.infer<typeof enableAutoMergeRequestSchema>;

const disableAutoMergeRequestSchema = z.object({ pullRequestId: z.string().min(1) }).strict();
export type DisableAutoMergeRequest = z.infer<typeof disableAutoMergeRequestSchema>;

const addPullRequestReviewRequestSchema = z
  .object({
    pullRequestId: z.string().min(1),
    commitOid: z.string().min(1),
    event: reviewEventSchema,
    body: z.string(),
    threads: z.array(
      commentDraftSchema
        .pick({ path: true, side: true, line: true, startLine: true })
        .extend({ body: z.string().min(1) })
        .strict(),
    ),
  })
  .strict();
export type AddPullRequestReviewRequest = z.infer<typeof addPullRequestReviewRequestSchema>;

export const hostContract = defineRpcContract({
  readPrVideo: { input: prImageRequestSchema, output: videoResultSchema },
  readPrImage: { input: prImageRequestSchema, output: imageResultSchema },
  fetchImageMergeBase: { input: prImageRefsSchema, output: ghResultSchema },
  fetchOverviewPage: {
    input: prPageRequestSchema,
    output: ghResultSchema,
  },
  fetchCheckRunDetails: {
    input: checkRunDetailsRequestSchema,
    output: ghResultSchema,
  },
  fetchPrFiles: {
    input: prFilesPageRequestSchema,
    output: ghResultSchema,
  },
  fetchReviewThreads: {
    input: prPageRequestSchema,
    output: ghResultSchema,
  },
  fetchPrHead: {
    input: prFilesRequestSchema,
    output: ghResultSchema,
  },
  fetchTimeline: {
    input: timelinePageRequestSchema,
    output: ghResultSchema,
  },
  addComment: {
    input: addCommentRequestSchema,
    output: ghResultSchema,
  },
  readTextFile: {
    input: readTextFileRequestSchema,
    output: readTextFileResultSchema,
  },
  countLocalCommitsAhead: {
    input: localCommitsRequestSchema,
    output: localCommitsAheadSchema,
  },
  replyToThread: {
    input: replyToThreadRequestSchema,
    output: ghResultSchema,
  },
  setThreadResolved: {
    input: setThreadResolvedRequestSchema,
    output: ghResultSchema,
  },
  fetchReviewQueue: {
    input: z.object({ tracked: z.array(z.object(prRequestFields).strict()) }).strict(),
    output: ghResultSchema,
  },
  fetchViewerTeams: {
    input: z.object({}).strict(),
    output: ghResultSchema,
  },
  fetchTeamPrPage: {
    input: teamPrPageRequestSchema,
    output: ghResultSchema,
  },
  mergePullRequest: {
    input: mergePullRequestRequestSchema,
    output: ghResultSchema,
  },
  enqueuePullRequest: {
    input: enqueuePullRequestRequestSchema,
    output: ghResultSchema,
  },
  updatePullRequestBranch: {
    input: updatePullRequestBranchRequestSchema,
    output: ghResultSchema,
  },
  enablePullRequestAutoMerge: {
    input: enableAutoMergeRequestSchema,
    output: ghResultSchema,
  },
  disablePullRequestAutoMerge: {
    input: disableAutoMergeRequestSchema,
    output: ghResultSchema,
  },
  submitReview: {
    input: addPullRequestReviewRequestSchema,
    output: ghResultSchema,
  },
  readRateLimitReset: {
    input: z.object({}).strict(),
    output: z.object({ resetAt: z.number().nullable() }).strict(),
  },
});

export const insightResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_pr") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({
    kind: z.literal("ok"),
    insight: prInsightSchema,
    refreshedAt: z.number(),
    error: z.string().nullable(),
  }),
]);
export type InsightResult = z.infer<typeof insightResultSchema>;

const reviewDraftsSchema = z.object({
  drafts: draftsSchema,
  commentDrafts: z.array(listedCommentDraftSchema),
  summaryDraft: summaryDraftSchema.nullable(),
});
export type ReviewDrafts = z.infer<typeof reviewDraftsSchema>;

export const reviewResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_pr") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  reviewDraftsSchema.extend({
    kind: z.literal("ok"),
    head: prHeadSchema,
    imageBasis: prImageBasisSchema.nullable().optional(),
    files: z.array(reviewFileSchema),
    threads: threadPlacementSchema,
    viewedMarks: viewedMarksSchema,
    newCommentIds: z.array(z.string()),
  }),
]);
export type ReviewResult = z.infer<typeof reviewResultSchema>;

export const draftsResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_pr") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  reviewDraftsSchema.extend({ kind: z.literal("ok") }),
]);
export type DraftsResult = z.infer<typeof draftsResultSchema>;

const threadRequestSchema = z.object({ threadId: z.string().min(1) }).strict();

const prInsightRequestSchema = z.object(prRequestFields).strict();
export type PrInsightRequest = z.infer<typeof prInsightRequestSchema>;

const sendToAgentRequestSchema = z
  .object({ threadId: z.string().min(1), reviewThreadIds: z.array(z.string().min(1)).min(1) })
  .strict();

export const sendToAgentResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sent"),
    delivery: z.enum(["sent", "queued"]),
    threadCount: z.number(),
  }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type SendToAgentResult = z.infer<typeof sendToAgentResultSchema>;

const replyRequestSchema = z
  .object({
    threadId: z.string().min(1),
    reviewThreadId: z.string().min(1),
    body: z.string().regex(/\S/),
    resolve: z.boolean(),
  })
  .strict();
export type ReplyRequest = z.infer<typeof replyRequestSchema>;

export const replyResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("posted"),
    pendingReviewUrl: z.string().nullable(),
    resolveError: z.string().nullable(),
  }),
  z.object({ kind: z.literal("post_failed"), message: z.string() }),
]);
export type ReplyResult = z.infer<typeof replyResultSchema>;

const setResolvedRequestSchema = z
  .object({
    threadId: z.string().min(1),
    reviewThreadId: z.string().min(1),
    resolved: z.boolean(),
  })
  .strict();
export type SetResolvedRequest = z.infer<typeof setResolvedRequestSchema>;

export const actionResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;

const timelineRequestSchema = z
  .object({ threadId: z.string().min(1), before: z.string().nullable() })
  .strict();

export const timelineResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("no_pr") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({
    kind: z.literal("ok"),
    prNodeId: z.string(),
    description: prDescriptionSchema,
    locked: z.boolean(),
    viewerCanUpdate: z.boolean(),
    events: z.array(timelineEventSchema),
    olderCursor: z.string().nullable(),
    newCommentIds: z.array(z.string()),
  }),
]);
export type TimelineResult = z.infer<typeof timelineResultSchema>;

const addPrCommentRequestSchema = z
  .object({
    threadId: z.string().min(1),
    prNodeId: z.string().min(1),
    body: z.string().regex(/\S/),
  })
  .strict();
export type AddPrCommentRequest = z.infer<typeof addPrCommentRequestSchema>;

const saveDraftRequestSchema = z
  .object({ threadId: z.string().min(1), reviewThreadId: z.string().min(1), body: z.string() })
  .strict();
export type SaveDraftRequest = z.infer<typeof saveDraftRequestSchema>;

const updateViewedRequestSchema = z
  .object({
    threadId: z.string().min(1),
    set: viewedMarksSchema,
    remove: z.array(z.string().min(1)),
  })
  .strict();
export type UpdateViewedRequest = z.infer<typeof updateViewedRequestSchema>;

const markCommentsSeenRequestSchema = z
  .object({ threadId: z.string().min(1), commentIds: z.array(z.string().min(1)).min(1) })
  .strict();
export type MarkCommentsSeenRequest = z.infer<typeof markCommentsSeenRequestSchema>;

const discardDraftRequestSchema = z
  .object({ threadId: z.string().min(1), reviewThreadId: z.string().min(1) })
  .strict();
export type DiscardDraftRequest = z.infer<typeof discardDraftRequestSchema>;

const createCommentDraftRequestSchema = z
  .object({
    threadId: z.string().min(1),
    path: z.string().min(1),
    side: z.enum(["LEFT", "RIGHT"]),
    line: z.number().int().positive(),
  })
  .strict();
export type CreateCommentDraftRequest = z.infer<typeof createCommentDraftRequestSchema>;

export const createCommentDraftResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("created"), draftId: z.string() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type CreateCommentDraftResult = z.infer<typeof createCommentDraftResultSchema>;

const saveCommentDraftRequestSchema = z
  .object({ threadId: z.string().min(1), draftId: z.string().min(1), body: z.string() })
  .strict();
export type SaveCommentDraftRequest = z.infer<typeof saveCommentDraftRequestSchema>;

const deleteCommentDraftRequestSchema = z
  .object({ threadId: z.string().min(1), draftId: z.string().min(1) })
  .strict();
export type DeleteCommentDraftRequest = z.infer<typeof deleteCommentDraftRequestSchema>;

const saveSummaryDraftRequestSchema = z
  .object({ threadId: z.string().min(1), body: z.string() })
  .strict();
export type SaveSummaryDraftRequest = z.infer<typeof saveSummaryDraftRequestSchema>;

const submitReviewRequestSchema = z
  .object({ threadId: z.string().min(1), event: reviewEventSchema, body: z.string() })
  .strict();
export type SubmitReviewRequest = z.infer<typeof submitReviewRequestSchema>;

export const submitReviewResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("submitted"), markError: z.string().optional() }),
  z.object({ kind: z.literal("error"), message: z.string(), url: z.string().nullable() }),
]);
export type SubmitReviewResult = z.infer<typeof submitReviewResultSchema>;

const prRefRequestSchema = z
  .object({ repo: z.string().min(1), number: z.number().int().positive() })
  .strict();

const markNeedsReviewRequestSchema = prRefRequestSchema;
export type MarkNeedsReviewRequest = z.infer<typeof markNeedsReviewRequestSchema>;

const markReviewedRequestSchema = prRefRequestSchema
  .extend({ headOid: z.string().min(1) })
  .strict();
export type MarkReviewedRequest = z.infer<typeof markReviewedRequestSchema>;

const markQueueSeenRequestSchema = z.object({ prs: z.array(prRefRequestSchema) }).strict();
export type MarkQueueSeenRequest = z.infer<typeof markQueueSeenRequestSchema>;

const newThreadRequestSchema = z.custom<NewThreadRequest>(
  (value) => typeof value === "object" && value !== null,
);

const startReviewRequestSchema = z
  .object({ pr: reviewPrSchema, request: newThreadRequestSchema })
  .strict();
export type StartReviewRequest = z.infer<typeof startReviewRequestSchema>;

export const startReviewResultSchema = z.object({ threadId: z.string() });
export type StartReviewResult = z.infer<typeof startReviewResultSchema>;

const primaryHostSchema = z.object({ hostId: z.string().nullable() });

export const prActionSchema = z.enum([
  "merge",
  "enqueue",
  "update-merge",
  "update-rebase",
  "enable-auto-merge",
  "disable-auto-merge",
]);
export type PrAction = z.infer<typeof prActionSchema>;

const runPrActionRequestSchema = z
  .object({
    threadId: z.string().min(1),
    action: prActionSchema,
    expectedHeadOid: z.string().min(1),
  })
  .strict();
export type RunPrActionRequest = z.infer<typeof runPrActionRequestSchema>;

export const rpcContract = defineRpcContract({
  getPrVideo: {
    input: z
      .object({
        threadId: z.string().min(1),
        expectedBasisKey: z.string(),
        path: imagePathSchema,
        side: imageSideSchema,
      })
      .strict(),
    output: videoResultSchema,
  },
  getPrImage: {
    input: z
      .object({
        threadId: z.string().min(1),
        expectedBasisKey: z.string(),
        path: imagePathSchema,
        side: imageSideSchema,
      })
      .strict(),
    output: imageResultSchema,
  },
  getInsight: { input: threadRequestSchema, output: insightResultSchema },
  refresh: { input: threadRequestSchema, output: insightResultSchema },
  getPrInsight: { input: prInsightRequestSchema, output: insightResultSchema },
  refreshPrInsight: { input: prInsightRequestSchema, output: insightResultSchema },
  getReview: { input: threadRequestSchema, output: reviewResultSchema },
  getDrafts: { input: threadRequestSchema, output: draftsResultSchema },
  getTimeline: { input: timelineRequestSchema, output: timelineResultSchema },
  addPrComment: { input: addPrCommentRequestSchema, output: actionResultSchema },
  sendToAgent: { input: sendToAgentRequestSchema, output: sendToAgentResultSchema },
  reply: { input: replyRequestSchema, output: replyResultSchema },
  setResolved: { input: setResolvedRequestSchema, output: actionResultSchema },
  saveDraft: { input: saveDraftRequestSchema, output: actionResultSchema },
  discardDraft: { input: discardDraftRequestSchema, output: actionResultSchema },
  createCommentDraft: {
    input: createCommentDraftRequestSchema,
    output: createCommentDraftResultSchema,
  },
  saveCommentDraft: { input: saveCommentDraftRequestSchema, output: actionResultSchema },
  deleteCommentDraft: { input: deleteCommentDraftRequestSchema, output: actionResultSchema },
  saveSummaryDraft: { input: saveSummaryDraftRequestSchema, output: actionResultSchema },
  updateViewed: { input: updateViewedRequestSchema, output: actionResultSchema },
  markCommentsSeen: { input: markCommentsSeenRequestSchema, output: actionResultSchema },
  submitReview: { input: submitReviewRequestSchema, output: submitReviewResultSchema },
  getReviewQueue: { input: z.object({}).strict(), output: reviewQueueResultSchema },
  refreshReviewQueue: { input: z.object({}).strict(), output: loadedReviewQueueSchema },
  startReview: { input: startReviewRequestSchema, output: startReviewResultSchema },
  getPrimaryHost: { input: z.object({}).strict(), output: primaryHostSchema },
  archiveReview: { input: threadRequestSchema, output: actionResultSchema },
  markReviewed: { input: markReviewedRequestSchema, output: actionResultSchema },
  markNeedsReview: { input: markNeedsReviewRequestSchema, output: actionResultSchema },
  markQueueSeen: { input: markQueueSeenRequestSchema, output: actionResultSchema },
  markThreadOpened: { input: threadRequestSchema, output: actionResultSchema },
  runPrAction: { input: runPrActionRequestSchema, output: actionResultSchema },
  localCommitsAhead: { input: threadRequestSchema, output: localCommitsAheadSchema },
});
