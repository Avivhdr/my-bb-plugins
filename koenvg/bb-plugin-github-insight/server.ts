import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  hostContract,
  rpcContract,
  type DraftsResult,
  type GhResult,
  type ReviewResult,
} from "./contract";
import { INSIGHT_UPDATED_CHANNEL, type InsightUpdated } from "./core/insight-updated";
import { collectInsight } from "./core/overview";
import { REVIEW_QUEUE_UPDATED_CHANNEL } from "./core/review-queue-updated";
import {
  REVIEW_DRAFTS_UPDATED_CHANNEL,
  REVIEW_UPDATED_CHANNEL,
  type ReviewUpdated,
} from "./core/review-updated";
import { newCommentDraftId } from "./core/review-drafts";
import { createMediaSigner } from "./core/signed-media";
import { reviewPrMetadata } from "./core/review-pr";
import { SUMMARY_METADATA_KEY } from "./core/summary";
import { GhFailureError } from "./github/gh-failure";
import { parseReviewQueue } from "./core/review-queue";
import { scanTeamPrs } from "./core/team-prs";
import { createLocalCommitsLookup } from "./merge/local-commits-lookup";
import { createPrWrites } from "./merge/pr-writes";
import { createPrLookup } from "./pr-lookup";
import { createRateLimitPause } from "./github/rate-limit-pause";
import { createReviewQueueService } from "./queue/review-queue-service";
import { createInsightService } from "./refresh/insight-service";
import { createDraftStore } from "./review/draft-store";
import { createReviewCli } from "./review/review-cli";
import { createReviewService } from "./review/review-service";
import { createReviewWrites } from "./review/review-writes";
import { createTimelineService } from "./timeline/timeline-service";
import { createViewedMarksStore } from "./review/viewed-marks-store";

export type { rpcContract } from "./contract";

function unwrap(result: GhResult): unknown {
  if (!result.ok) throw new GhFailureError(result.failure);
  return result.data;
}

export default async function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const pause = createRateLimitPause();
  const primaryHostId = async () => (await bb.sdk.system.config()).primaryHostId;
  const { resolvePr, resolveEnvironmentPr } = createPrLookup({
    sdk: bb.sdk,
    pause,
    readRateLimitReset: async (hostId) =>
      (await host.call("readRateLimitReset", {}, { hostId })).resetAt,
  });

  const service = createInsightService({
    listThreads: async () =>
      (await bb.sdk.threads.list({ includeHidden: true })).filter(
        (thread) => thread.archivedAt === null,
      ),
    resolvePr,
    resolveEnvironmentPr,
    fetchInsight: ({ ref, hostId }) =>
      collectInsight({
        fetchOverviewPage: async (after) =>
          unwrap(await host.call("fetchOverviewPage", { ...ref, after }, { hostId })),
        fetchCheckRunDetails: async (ids) =>
          unwrap(await host.call("fetchCheckRunDetails", { ids }, { hostId })),
      }),
    primaryHostId,
    publish: (update: InsightUpdated) => bb.realtime.publish(INSIGHT_UPDATED_CHANNEL, update),
    writeSummary: async (threadId, summary) => {
      await bb.sdk.threads.updatePluginMetadata({
        threadId,
        set: { [SUMMARY_METADATA_KEY]: summary },
      });
    },
    removeSummary: async (threadId) => {
      await bb.sdk.threads.updatePluginMetadata({ threadId, remove: [SUMMARY_METADATA_KEY] });
    },
    kv: bb.storage.kv,
    pause,
    warn: (message) => bb.log.warn(message),
  });

  const drafts = createDraftStore(bb.storage.kv);
  const publishReviewUpdate = (update: ReviewUpdated) =>
    bb.realtime.publish(REVIEW_UPDATED_CHANNEL, update);
  const publishDraftsUpdate = (update: ReviewUpdated) =>
    bb.realtime.publish(REVIEW_DRAFTS_UPDATED_CHANNEL, update);

  const signMedia = createMediaSigner(Date.now);

  const review = createReviewService({
    resolvePr,
    signMedia,
    now: Date.now,
    newDraftId: newCommentDraftId,
    fetchPrFilesPage: async ({ ref, hostId }, page) =>
      unwrap(await host.call("fetchPrFiles", { ...ref, page }, { hostId })),
    fetchReviewThreadsPage: async ({ ref, hostId }, after) =>
      unwrap(await host.call("fetchReviewThreads", { ...ref, after }, { hostId })),
    fetchPrHead: async ({ ref, hostId }) => unwrap(await host.call("fetchPrHead", ref, { hostId })),
    fetchImageMergeBase: async ({ hostId }, refs) =>
      unwrap(await host.call("fetchImageMergeBase", refs, { hostId })),
    readPrVideo: async ({ hostId }, request) =>
      host.call("readPrVideo", request, { hostId, timeoutMs: 45_000 }),
    readPrImage: async ({ hostId }, request) => host.call("readPrImage", request, { hostId }),
    drafts,
    publishDrafts: publishDraftsUpdate,
    viewed: createViewedMarksStore(bb.storage.kv),
    newCommentBasis: (pr) => reviewQueue.newCommentBasis(pr),
    markCommentsSeen: (pr, ids) => reviewQueue.markCommentsSeen(pr, ids),
    sendMessage: async (threadId, text) => {
      const result = await bb.sdk.threads.send({
        threadId,
        mode: "auto",
        input: [{ type: "text", text, mentions: [] }],
      });
      return result.delivery;
    },
  });

  const writes = createReviewWrites({
    resolvePr,
    replyToThread: async ({ hostId }, threadId, body) =>
      unwrap(await host.call("replyToThread", { threadId, body }, { hostId })),
    setThreadResolved: async ({ hostId }, threadId, resolved) =>
      unwrap(await host.call("setThreadResolved", { threadId, resolved }, { hostId })),
    loadReview: (threadId) => review.load(threadId),
    loadBasis: (threadId) => review.loadBasis(threadId),
    submitReview: async ({ hostId }, request) =>
      unwrap(await host.call("submitReview", request, { hostId })),
    drafts,
    publish: publishReviewUpdate,
    publishDrafts: publishDraftsUpdate,
    refreshAfterWrite: (threadId) => service.refreshAfterWrite(threadId),
    markReviewed: ({ owner, repo, number }, headOid) =>
      reviewQueue.markReviewed({ repo: `${owner}/${repo}`, number, headOid }),
    now: Date.now,
    createLocalCommentDraft: review.createCommentDraft,
    warn: (message) => bb.log.warn(message),
  });

  const reviewQueue = createReviewQueueService({
    primaryHostId,
    fetchReviewQueue: async (hostId, tracked) =>
      parseReviewQueue(
        unwrap(await host.call("fetchReviewQueue", { tracked }, { hostId })),
        tracked,
        Date.now(),
      ),
    scanTeamPrs: (hostId, request) =>
      scanTeamPrs(
        {
          fetchViewerTeams: async () => unwrap(await host.call("fetchViewerTeams", {}, { hostId })),
          fetchPage: async (page) => unwrap(await host.call("fetchTeamPrPage", page, { hostId })),
        },
        request,
      ),
    listProjects: () => bb.sdk.projects.list(),
    listThreads: () => bb.sdk.threads.list({ includeHidden: true }),
    listReviewThreads: () =>
      bb.sdk.threads.list({ includeHidden: true, originPluginId: bb.pluginId }),
    readPluginMetadata: (threadId) => bb.sdk.threads.getPluginMetadata({ threadId }),
    spawnReviewThread: async (pr, request) => {
      const thread = await bb.sdk.threads.spawn({
        ...request,
        visibility: "hidden",
        pluginMetadata: reviewPrMetadata(pr),
      });
      return thread.id;
    },
    archiveThread: async (threadId) => {
      await bb.sdk.threads.archive({ threadId });
    },
    resolveEnvironmentPr,
    kv: bb.storage.kv,
    publish: (result) => bb.realtime.publish(REVIEW_QUEUE_UPDATED_CHANNEL, result),
    warn: (message) => bb.log.warn(message),
    now: Date.now,
  });

  const prWrites = createPrWrites({
    cachedPr: (threadId) => service.cachedPr(threadId),
    mergePullRequest: async ({ hostId }, request) =>
      unwrap(await host.call("mergePullRequest", request, { hostId })),
    enqueuePullRequest: async ({ hostId }, request) =>
      unwrap(await host.call("enqueuePullRequest", request, { hostId })),
    updatePullRequestBranch: async ({ hostId }, request) =>
      unwrap(await host.call("updatePullRequestBranch", request, { hostId })),
    enablePullRequestAutoMerge: async ({ hostId }, request) =>
      unwrap(await host.call("enablePullRequestAutoMerge", request, { hostId })),
    disablePullRequestAutoMerge: async ({ hostId }, request) =>
      unwrap(await host.call("disablePullRequestAutoMerge", request, { hostId })),
    refreshAfterWrite: (threadId) => service.refreshAfterWrite(threadId),
    warn: (message) => bb.log.warn(message),
  });

  const localCommits = createLocalCommitsLookup({
    cachedPr: (threadId) => service.cachedPr(threadId),
    environmentIdOf: async (threadId) => (await bb.sdk.threads.get({ threadId })).environmentId,
    environment: async (environmentId) => {
      const { hostId, path } = await bb.sdk.environments.get({ environmentId });
      return { hostId, path: path ?? null };
    },
    countLocalCommitsAhead: (hostId, request) =>
      host.call("countLocalCommitsAhead", request, { hostId }),
    warn: (message) => bb.log.warn(message),
  });

  const timeline = createTimelineService({
    resolvePr,
    fetchTimelinePage: async ({ ref, hostId }, before) =>
      unwrap(await host.call("fetchTimeline", { ...ref, before }, { hostId })),
    addComment: async ({ hostId }, request) =>
      unwrap(await host.call("addComment", request, { hostId })),
    newCommentBasis: (pr) => reviewQueue.newCommentBasis(pr),
    signMedia,
  });

  async function getReview(threadId: string): Promise<ReviewResult> {
    const load = await review.loadForDisplay(threadId);
    return load.kind === "ok" ? { kind: "ok", ...load.review } : load;
  }

  async function getDrafts(threadId: string): Promise<DraftsResult> {
    const load = await review.loadDrafts(threadId);
    return load.kind === "ok" ? { kind: "ok", ...load.drafts } : load;
  }

  bb.rpc.register(rpcContract, {
    getPrVideo: ({ threadId, expectedBasisKey, path, side }) =>
      review.getPrVideo(threadId, expectedBasisKey, path, side),
    getPrImage: ({ threadId, expectedBasisKey, path, side }) =>
      review.getPrImage(threadId, expectedBasisKey, path, side),
    getInsight: ({ threadId }) => service.getInsight(threadId),
    refresh: ({ threadId }) => service.refresh(threadId),
    getPrInsight: (ref) => service.getPrInsight(ref),
    refreshPrInsight: (ref) => service.refreshPrInsight(ref),
    getReview: ({ threadId }) => getReview(threadId),
    getDrafts: ({ threadId }) => getDrafts(threadId),
    getTimeline: ({ threadId, before }) => timeline.getTimeline(threadId, before),
    addPrComment: (request) => timeline.addPrComment(request),
    sendToAgent: ({ threadId, reviewThreadIds }) => review.sendToAgent(threadId, reviewThreadIds),
    reply: (request) => writes.reply(request),
    setResolved: (request) => writes.setResolved(request),
    saveDraft: (request) => writes.saveDraft(request),
    discardDraft: (request) => writes.discardDraft(request),
    createCommentDraft: (request) => writes.createCommentDraft(request),
    saveCommentDraft: (request) => writes.saveCommentDraft(request),
    deleteCommentDraft: (request) => writes.deleteCommentDraft(request),
    saveSummaryDraft: (request) => writes.saveSummaryDraft(request),
    updateViewed: (request) => review.updateViewed(request),
    markCommentsSeen: (request) => review.markCommentsSeen(request),
    submitReview: (request) => writes.submitReview(request),
    getReviewQueue: () => reviewQueue.getReviewQueue(),
    refreshReviewQueue: () => reviewQueue.refreshReviewQueue(),
    startReview: async ({ pr, request }) => ({
      threadId: await reviewQueue.startReview(pr, request),
    }),
    getPrimaryHost: async () => ({ hostId: await primaryHostId() }),
    archiveReview: ({ threadId }) => reviewQueue.archiveReview(threadId),
    markReviewed: (request) => reviewQueue.markReviewed(request),
    markNeedsReview: (request) => reviewQueue.markNeedsReview(request),
    markQueueSeen: (request) => reviewQueue.markQueueSeen(request),
    markThreadOpened: (request) => reviewQueue.markThreadOpened(request),
    runPrAction: (request) => prWrites.runPrAction(request),
    localCommitsAhead: ({ threadId }) => localCommits.localCommitsAhead(threadId),
  });

  bb.cli.register(
    createReviewCli({
      review,
      readTextFile: (hostId, request) => host.call("readTextFile", request, { hostId }),
      now: Date.now,
    }),
  );

  bb.background.service("pr-poller", { start: (signal) => service.run(signal) });
  bb.background.service("review-queue", { start: (signal) => reviewQueue.run(signal) });

  const unloaded = new AbortController();
  bb.onDispose(() => unloaded.abort());
  bb.events.on("thread.active", ({ thread }) => {
    void reviewQueue.threadActive(thread.id);
  });
  bb.events.on("thread.idle", ({ thread }) => {
    void service.refreshOnIdle(thread.id, unloaded.signal);
    void reviewQueue.threadStopped(thread.id);
  });
  bb.events.on("thread.failed", ({ thread }) => {
    void reviewQueue.threadStopped(thread.id);
  });
}
