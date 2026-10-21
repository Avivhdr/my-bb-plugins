import { describe, expect, it } from "vitest";
import type { DraftStore } from "./draft-store";
import type { ReviewLoad } from "./review-service";
import { createReviewWrites } from "./review-writes";

const target = {
  ref: { owner: "collibra", repo: "frontend", number: 25259 },
  hostId: "host-1",
  openOnBb: true,
};
const loaded: ReviewLoad = {
  kind: "ok",
  target,
  allThreadsRead: true,
  review: {
    head: {
      prNodeId: "PR_1",
      oid: "def456",
      state: "OPEN",
      viewerIsAuthor: false,
      viewerReview: null,
    },
    files: [],
    threads: { placed: [], outdated: [] },
    drafts: {},
    commentDrafts: [],
    summaryDraft: null,
    viewedMarks: {},
    newCommentIds: [],
  },
};

type Deps = Parameters<typeof createReviewWrites>[0];

function writesWith(overrides: Partial<Deps> = {}) {
  const refreshed: string[] = [];
  const marked: unknown[] = [];
  const writes = createReviewWrites({
    resolvePr: async () => ({ kind: "pr" as const, target }),
    replyToThread: async () => ({ data: {} }),
    setThreadResolved: async () => ({ data: {} }),
    loadReview: async () => loaded,
    submitReview: async () => ({ data: {} }),
    drafts: { delete: async () => {} } as unknown as DraftStore,
    publish: () => {},
    publishDrafts: () => {},
    loadBasis: async () => ({ kind: "no_pr" as const }),
    refreshAfterWrite: async (threadId) => {
      refreshed.push(threadId);
    },
    markReviewed: async (ref, commitOid) => {
      marked.push([ref, commitOid]);
      return { kind: "ok" };
    },
    now: () => 1,
    createLocalCommentDraft: async () => ({ kind: "created", draftId: "n1" }),
    warn: () => {},
    ...overrides,
  });
  return { writes, refreshed, marked };
}

const failing = async () => {
  throw new Error("gh down");
};

describe("review writes", () => {
  it("reports a posted reply as posted when its draft cannot be deleted", async () => {
    const warnings: string[] = [];
    const { writes } = writesWith({
      drafts: { delete: () => Promise.reject(new Error("disk full")) } as unknown as DraftStore,
      warn: (message) => warnings.push(message),
    });

    const result = await writes.reply({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      body: "Done",
      resolve: false,
    });

    expect(result).toEqual({ kind: "posted", pendingReviewUrl: null, resolveError: null });
    expect(warnings).toEqual([
      "Posted a reply to PRRT_a, but could not delete its draft: Error: disk full",
    ]);
  });

  it.each([true, false])(
    "refreshes the PR insight after setting resolved to %s",
    async (resolved) => {
      const { writes, refreshed } = writesWith();

      await writes.setResolved({ threadId: "thr_1", reviewThreadId: "PRRT_a", resolved });

      expect(refreshed).toEqual(["thr_1"]);
    },
  );

  it("refreshes the PR insight after a post and resolve", async () => {
    const { writes, refreshed } = writesWith();

    await writes.reply({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      body: "Done",
      resolve: true,
    });

    expect(refreshed).toEqual(["thr_1"]);
  });

  it("does not refresh the PR insight after a post without resolve", async () => {
    const { writes, refreshed } = writesWith();

    await writes.reply({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      body: "Done",
      resolve: false,
    });

    expect(refreshed).toEqual([]);
  });

  it("does not refresh the PR insight when the resolve fails", async () => {
    const { writes, refreshed } = writesWith({ setThreadResolved: failing });

    await writes.setResolved({ threadId: "thr_1", reviewThreadId: "PRRT_a", resolved: true });
    await writes.reply({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      body: "Done",
      resolve: true,
    });

    expect(refreshed).toEqual([]);
  });

  it("does not refresh the PR insight when the post fails", async () => {
    const { writes, refreshed } = writesWith({ replyToThread: failing });

    await writes.reply({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      body: "Done",
      resolve: true,
    });

    expect(refreshed).toEqual([]);
  });

  it("reports the write as done when the refresh after it fails", async () => {
    const { writes } = writesWith({ refreshAfterWrite: failing });

    const resolved = await writes.setResolved({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      resolved: true,
    });
    const posted = await writes.reply({
      threadId: "thr_1",
      reviewThreadId: "PRRT_a",
      body: "Done",
      resolve: true,
    });

    expect(resolved).toEqual({ kind: "ok" });
    expect(posted).toEqual({ kind: "posted", pendingReviewUrl: null, resolveError: null });
  });

  it("reports a submitted review as submitted when its drafts cannot be deleted", async () => {
    const warnings: string[] = [];
    const { writes, refreshed } = writesWith({
      drafts: {
        deleteReviewDrafts: () => Promise.reject(new Error("disk full")),
      } as unknown as DraftStore,
      warn: (message) => warnings.push(message),
    });

    const result = await writes.submitReview({ threadId: "thr_1", event: "APPROVE", body: "" });

    expect(result).toEqual({ kind: "submitted" });
    expect(refreshed).toEqual(["thr_1"]);
    expect(warnings).toEqual([
      "Submitted a review on thread thr_1, but could not delete its drafts: Error: disk full",
    ]);
  });

  it("reports the submit as done when the refresh after it fails", async () => {
    const { writes } = writesWith({
      drafts: { deleteReviewDrafts: async () => {} } as unknown as DraftStore,
      refreshAfterWrite: failing,
    });

    expect(await writes.submitReview({ threadId: "thr_1", event: "APPROVE", body: "" })).toEqual({
      kind: "submitted",
    });
  });

  const noDraftsLeft = { deleteReviewDrafts: async () => {} } as unknown as DraftStore;

  it("marks the PR reviewed at the head after a submit without comment drafts", async () => {
    const { writes, marked } = writesWith({ drafts: noDraftsLeft });

    await writes.submitReview({ threadId: "thr_1", event: "APPROVE", body: "" });

    expect(marked).toEqual([[target.ref, "def456"]]);
  });

  it("marks the PR reviewed at the commit of older comment drafts", async () => {
    const commentDraft = {
      id: "d1",
      path: "a.ts",
      side: "RIGHT",
      line: 3,
      startLine: null,
      body: "Nit",
      commitOid: "abc123",
      updatedAt: 1,
      source: "agent",
    };
    const { writes, marked } = writesWith({
      drafts: noDraftsLeft,
      loadReview: async () =>
        (loaded.kind === "ok"
          ? { ...loaded, review: { ...loaded.review, commentDrafts: [commentDraft] } }
          : loaded) as ReviewLoad,
    });

    await writes.submitReview({ threadId: "thr_1", event: "COMMENT", body: "" });

    expect(marked).toEqual([[target.ref, "abc123"]]);
  });

  it("does not mark the PR reviewed when the viewer is the author", async () => {
    const { writes, marked } = writesWith({
      drafts: noDraftsLeft,
      loadReview: async () =>
        (loaded.kind === "ok"
          ? {
              ...loaded,
              review: { ...loaded.review, head: { ...loaded.review.head, viewerIsAuthor: true } },
            }
          : loaded) as ReviewLoad,
    });

    await writes.submitReview({ threadId: "thr_1", event: "COMMENT", body: "Thanks" });

    expect(marked).toEqual([]);
  });

  it("does not mark the PR reviewed when GitHub rejects the submit", async () => {
    const { writes, marked } = writesWith({ drafts: noDraftsLeft, submitReview: failing });

    await writes.submitReview({ threadId: "thr_1", event: "APPROVE", body: "" });

    expect(marked).toEqual([]);
  });

  it("reports the submit as done with the mark error when the mark cannot be saved", async () => {
    const { writes } = writesWith({
      drafts: noDraftsLeft,
      markReviewed: async () => ({ kind: "error", message: "disk full" }),
    });

    expect(await writes.submitReview({ threadId: "thr_1", event: "APPROVE", body: "" })).toEqual({
      kind: "submitted",
      markError: "disk full",
    });
  });
});
