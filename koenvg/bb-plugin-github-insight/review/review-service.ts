import { isVideoPath, type VideoWireResult } from "../core/video-content";
import { z } from "zod";
import {
  imageBasisKey,
  parseImageRefs,
  type PrImageBasis,
  type PrImageRefs,
} from "../core/pr-image-basis";
import {
  imageError,
  imagePath,
  isRasterPath,
  imageShaSchema,
  type ImageSide,
  type ImageWireResult,
} from "../core/image-content";
import type {
  ActionResult,
  MarkCommentsSeenRequest,
  ReviewDrafts,
  SendToAgentResult,
  UpdateViewedRequest,
} from "../contract";
import { buildAgentPrompt } from "../core/agent-prompt";
import type { Draft, Drafts } from "../core/drafts";
import { checkAnchor, type Anchor } from "../core/diff-lines";
import { checkOneCommit } from "../core/draft-commits";
import { newCommentIds } from "../core/new-comments";
import { collectPrFiles, type ReviewFile } from "../core/pr-files";
import { parsePrHead, type PrHead } from "../core/pr-head";
import { prKey, type PullRequestRef } from "../core/pr-ref";
import { hasText, type ListedCommentDraft, type SummaryDraft } from "../core/review-drafts";
import {
  collectReviewThreads,
  type CollectedReviewThreads,
  type ReviewThread,
} from "../core/review-threads";
import type { SignMedia } from "../core/signed-media";
import type { ReviewUpdated } from "../core/review-updated";
import { openThreads, placeThreads, type ThreadPlacement } from "../core/thread-placement";
import type { ViewedMarks } from "../core/viewed-marks";
import { GhFailureError, ghFailureText } from "../github/gh-failure";
import { RECHECK_NO_PR, type LookupOptions, type PrResolution, type PrTarget } from "../pr-lookup";
import type { CommentEdit, DraftStore } from "./draft-store";
import type { ViewedMarksStore } from "./viewed-marks-store";

export interface PrReview extends ReviewDrafts {
  head: PrHead;
  imageBasis?: PrImageBasis | null;
  files: ReviewFile[];
  threads: ThreadPlacement;
  viewedMarks: ViewedMarks;
  newCommentIds: string[];
}

export interface ReviewBasis {
  head: PrHead;
  files: ReviewFile[];
  commentDrafts: ListedCommentDraft[];
}

type NewCommentDraft = { anchor: Anchor } & (
  | { source: "agent"; readBody(): Promise<string> }
  | { source: "user" }
);

type CommentDraftCreation =
  | { kind: "created"; draftId: string }
  | { kind: "error"; reason: "anchor" | "commit" | "empty"; message: string };

export type PrLoad<T> =
  | { kind: "no_pr" }
  | { kind: "error"; message: string }
  | ({ kind: "ok"; target: PrTarget } & T);

export type ReviewLoad = PrLoad<{ allThreadsRead: boolean; review: PrReview }>;
export type DraftsLoad = PrLoad<{ drafts: ReviewDrafts }>;
export type BasisLoad = PrLoad<{ basis: ReviewBasis }>;
export type TargetLoad = PrLoad<object>;

interface LoadedPr {
  head: PrHead;
  imageBasis: PrImageBasis | null;
  hostId: string;
  files: ReviewFile[];
  collected: CollectedReviewThreads;
}

interface ReviewServiceDeps {
  resolvePr(threadId: string, options?: LookupOptions): Promise<PrResolution>;
  fetchPrFilesPage(target: PrTarget, page: number): Promise<unknown>;
  fetchReviewThreadsPage(target: PrTarget, after: string | null): Promise<unknown>;
  fetchPrHead(target: PrTarget): Promise<unknown>;
  fetchImageMergeBase?(target: PrTarget, refs: PrImageRefs): Promise<unknown>;
  readPrVideo?(
    target: PrTarget,
    request: { owner: string; repo: string; sha: string; path: string },
  ): Promise<VideoWireResult>;
  readPrImage?(
    target: PrTarget,
    request: { owner: string; repo: string; sha: string; path: string },
  ): Promise<ImageWireResult>;
  drafts: DraftStore;
  viewed: ViewedMarksStore;
  newCommentBasis(pr: PullRequestRef): Promise<{ markedAt: number | null; seen: Set<string> }>;
  markCommentsSeen(pr: PullRequestRef, ids: readonly string[]): Promise<ActionResult>;
  publishDrafts(update: ReviewUpdated): void;
  sendMessage(threadId: string, text: string): Promise<"sent" | "queued">;
  signMedia: SignMedia;
  now(): number;
  newDraftId(): string;
}

export type ReviewService = ReturnType<typeof createReviewService>;

export function createReviewService(deps: ReviewServiceDeps) {
  const loadedPrs = new Map<string, { value: LoadedPr | null }>();

  async function withPr<T>(
    threadId: string,
    read: (target: PrTarget) => Promise<T>,
  ): Promise<PrLoad<T>> {
    const resolution = await deps.resolvePr(threadId, RECHECK_NO_PR);
    if (resolution.kind !== "pr") return resolution;
    try {
      return { kind: "ok", target: resolution.target, ...(await read(resolution.target)) };
    } catch (error) {
      if (error instanceof GhFailureError) {
        return { kind: "error", message: ghFailureText(error.failure) };
      }
      throw error;
    }
  }

  async function fetchPr(target: PrTarget): Promise<LoadedPr> {
    const slot: { value: LoadedPr | null } = { value: null };
    loadedPrs.set(prKey(target.ref), slot);
    const [{ head, files, imageBasis }, collected] = await Promise.all([
      (async () => {
        let rawHead = await deps.fetchPrHead(target);
        let refs = parseImageRefs(rawHead);
        let files = await collectPrFiles((page) => deps.fetchPrFilesPage(target, page));
        let imageBasis: PrImageBasis | null = null;
        for (let attempt = 0; attempt < 2 && refs !== null; attempt++) {
          if (
            !files.some(
              (file) =>
                isRasterPath(file.path) ||
                isRasterPath(file.previousPath ?? "") ||
                isVideoPath(file.path) ||
                isVideoPath(file.previousPath ?? ""),
            )
          )
            break;
          const nextRaw = await deps.fetchPrHead(target).catch(() => null);
          const nextRefs = parseImageRefs(nextRaw);
          if (JSON.stringify(refs) === JSON.stringify(nextRefs)) {
            try {
              const compared = await deps.fetchImageMergeBase?.(target, refs);
              const { merge_base_commit } = z
                .object({ merge_base_commit: z.object({ sha: imageShaSchema }) })
                .parse(compared);
              imageBasis = { ...refs, mergeBaseSha: merge_base_commit.sha, hostId: target.hostId };
            } catch {
              /* Text review remains available when image revisions cannot be resolved. */
            }
            break;
          }
          if (attempt === 1 || nextRefs === null) break;
          rawHead = nextRaw;
          refs = nextRefs;
          files = await collectPrFiles((page) => deps.fetchPrFilesPage(target, page));
        }
        return { head: parsePrHead(rawHead), files, imageBasis };
      })(),
      collectReviewThreads((after) => deps.fetchReviewThreadsPage(target, after)),
    ]);
    const loaded = {
      head,
      files,
      collected,
      imageBasis,
      hostId: target.hostId,
    };
    if (loadedPrs.get(prKey(target.ref)) === slot) slot.value = loaded;
    return loaded;
  }

  async function loadedPr(target: PrTarget): Promise<LoadedPr> {
    return loadedPrs.get(prKey(target.ref))?.value ?? fetchPr(target);
  }

  async function readDrafts(pr: PullRequestRef, replyDrafts: Promise<Drafts>) {
    const [drafts, commentDrafts, summaryDraft] = await Promise.all([
      replyDrafts,
      deps.drafts.comments(pr),
      deps.drafts.summary(pr),
    ]);
    return { drafts, commentDrafts, summaryDraft };
  }

  function signedThreads({ threads, bodyHtml }: CollectedReviewThreads): ReviewThread[] {
    return threads.map((thread) => ({
      ...thread,
      comments: thread.comments.map((comment) => ({
        ...comment,
        body: deps.signMedia(comment.body, bodyHtml.get(comment.id) ?? ""),
      })),
    }));
  }

  function load(threadId: string): Promise<ReviewLoad> {
    return loadReview(threadId, ({ threads }) => threads);
  }

  function loadForDisplay(threadId: string): Promise<ReviewLoad> {
    return loadReview(threadId, signedThreads);
  }

  function loadReview(
    threadId: string,
    threadsOf: (collected: CollectedReviewThreads) => ReviewThread[],
  ): Promise<ReviewLoad> {
    return withPr(threadId, async (target) => {
      const { head, files, collected, imageBasis } = await fetchPr(target);
      const [drafts, viewedMarks, { markedAt, seen }] = await Promise.all([
        readDrafts(target.ref, deps.drafts.liveDrafts(target.ref, collected)),
        deps.viewed.get(target.ref),
        deps.newCommentBasis(target.ref),
      ]);
      const threads = placeThreads(files, threadsOf(collected));
      const newIds = newCommentIds(collected.othersComments, markedAt, seen);
      return {
        allThreadsRead: collected.complete,
        review: { head, files, imageBasis, threads, viewedMarks, newCommentIds: newIds, ...drafts },
      };
    });
  }

  function loadDrafts(threadId: string): Promise<DraftsLoad> {
    return withPr(threadId, async (target) => {
      const { collected } = await loadedPr(target);
      return {
        drafts: await readDrafts(target.ref, deps.drafts.knownDrafts(target.ref, collected)),
      };
    });
  }

  function loadBasis(threadId: string): Promise<BasisLoad> {
    return withPr(threadId, async (target) => {
      const [{ head, files }, commentDrafts] = await Promise.all([
        loadedPr(target),
        deps.drafts.comments(target.ref),
      ]);
      return { basis: { head, files, commentDrafts } };
    });
  }

  async function saveDraft(
    threadId: string,
    pr: PullRequestRef,
    reviewThreadId: string,
    draft: Draft,
  ) {
    await deps.drafts.save(pr, reviewThreadId, draft);
    deps.publishDrafts({ threadId });
  }

  async function createCommentDraft(
    threadId: string,
    pr: PullRequestRef,
    basis: ReviewBasis,
    input: NewCommentDraft,
  ): Promise<CommentDraftCreation> {
    const placed = checkAnchor(basis.files, input.anchor);
    if (!placed.ok) return { kind: "error", reason: "anchor", message: placed.reason };
    const oneCommit = checkOneCommit(basis.commentDrafts, basis.head.oid);
    if (!oneCommit.ok) return { kind: "error", reason: "commit", message: oneCommit.message };
    const body = input.source === "agent" ? await input.readBody() : "";
    if (input.source === "agent" && !hasText(body)) {
      return { kind: "error", reason: "empty", message: "Comment is empty" };
    }
    const draftId = deps.newDraftId();
    await deps.drafts.saveComment(pr, draftId, {
      ...input.anchor,
      body,
      commitOid: basis.head.oid,
      updatedAt: deps.now(),
      source: input.source,
    });
    deps.publishDrafts({ threadId });
    return { kind: "created", draftId };
  }

  function loadTarget(threadId: string): Promise<TargetLoad> {
    return withPr(threadId, async () => ({}));
  }

  async function editCommentDraft(
    threadId: string,
    pr: PullRequestRef,
    draftId: string,
    edit: CommentEdit,
  ): Promise<boolean> {
    const edited = await deps.drafts.editComment(pr, draftId, edit);
    if (edited) deps.publishDrafts({ threadId });
    return edited;
  }

  async function deleteCommentDraft(
    threadId: string,
    pr: PullRequestRef,
    draftId: string,
  ): Promise<boolean> {
    if ((await deps.drafts.comment(pr, draftId)) === null) return false;
    await deps.drafts.deleteComment(pr, draftId);
    deps.publishDrafts({ threadId });
    return true;
  }

  async function saveSummaryDraft(threadId: string, pr: PullRequestRef, draft: SummaryDraft) {
    await deps.drafts.saveSummary(pr, draft);
    deps.publishDrafts({ threadId });
  }

  async function withPrRef(
    threadId: string,
    write: (pr: PullRequestRef) => Promise<ActionResult>,
  ): Promise<ActionResult> {
    const resolution = await deps.resolvePr(threadId, RECHECK_NO_PR);
    if (resolution.kind === "error") return resolution;
    if (resolution.kind === "no_pr")
      return { kind: "error", message: "No pull request for this thread" };
    return write(resolution.target.ref);
  }

  async function updateViewed({
    threadId,
    set,
    remove,
  }: UpdateViewedRequest): Promise<ActionResult> {
    return withPrRef(threadId, (pr) => deps.viewed.update(pr, set, remove));
  }

  async function markCommentsSeen({
    threadId,
    commentIds,
  }: MarkCommentsSeenRequest): Promise<ActionResult> {
    return withPrRef(threadId, (pr) => deps.markCommentsSeen(pr, commentIds));
  }

  async function sendToAgent(
    threadId: string,
    reviewThreadIds: readonly string[],
  ): Promise<SendToAgentResult> {
    const loaded = await load(threadId);
    if (loaded.kind === "no_pr")
      return { kind: "error", message: "No pull request for this thread" };
    if (loaded.kind === "error") return loaded;
    const selected = new Set(reviewThreadIds);
    const threads = openThreads(loaded.review.threads).filter(({ thread }) =>
      selected.has(thread.id),
    );
    if (threads.length === 0) {
      return { kind: "error", message: "The selected review threads are resolved or gone" };
    }
    const delivery = await deps.sendMessage(threadId, buildAgentPrompt(threads));
    return { kind: "sent", delivery, threadCount: threads.length };
  }

  function getPrContent(
    kind: "image",
    threadId: string,
    expectedBasisKey: string,
    path: string,
    side: ImageSide,
  ): Promise<ImageWireResult>;
  function getPrContent(
    kind: "video",
    threadId: string,
    expectedBasisKey: string,
    path: string,
    side: ImageSide,
  ): Promise<VideoWireResult>;
  async function getPrContent(
    kind: "image" | "video",
    threadId: string,
    expectedBasisKey: string,
    path: string,
    side: ImageSide,
  ): Promise<ImageWireResult | VideoWireResult> {
    const resolution = await deps.resolvePr(threadId, RECHECK_NO_PR);
    if (resolution.kind !== "pr")
      return imageError("stale", "Pull request changed. Refresh the review.");
    const target = resolution.target;
    const slot = loadedPrs.get(prKey(target.ref));
    const loaded = slot?.value;
    const basis = loaded?.imageBasis;
    if (
      !basis ||
      basis.hostId !== target.hostId ||
      imageBasisKey(basis) !== expectedBasisKey ||
      basis.baseRepo.owner.toLowerCase() !== target.ref.owner.toLowerCase() ||
      basis.baseRepo.repo.toLowerCase() !== target.ref.repo.toLowerCase()
    )
      return imageError("stale", "Preview revisions changed. Refresh the review.");
    const file = loaded.files.find((file) => file.path === path);
    if (!file) return imageError("stale", "File changed. Refresh the review.");
    try {
      const sidePath = imagePath(file, side);
      if (sidePath === null) return { kind: "absent" };
      const repo = side === "before" ? basis.baseRepo : basis.headRepo;
      const sha = side === "before" ? basis.mergeBaseSha : basis.headSha;
      if (kind === "video" && !isVideoPath(file.path) && !isVideoPath(file.previousPath ?? ""))
        return imageError("unsupported", "This side is not an MP4 or WebM video");
      const reader = kind === "video" ? deps.readPrVideo : deps.readPrImage;
      const result =
        (await reader?.(target, { ...repo, sha, path: sidePath })) ??
        imageError("read", "Preview reader unavailable");
      return loadedPrs.get(prKey(target.ref)) === slot
        ? result
        : imageError("stale", "Review refreshed. Retry the preview.");
    } catch {
      return imageError("read", "Could not read preview at this revision");
    }
  }

  return {
    getPrImage: (threadId: string, key: string, path: string, side: ImageSide) =>
      getPrContent("image", threadId, key, path, side),
    getPrVideo: (threadId: string, key: string, path: string, side: ImageSide) =>
      getPrContent("video", threadId, key, path, side),
    load,
    loadForDisplay,
    loadDrafts,
    loadBasis,
    loadTarget,
    saveDraft,
    createCommentDraft,
    editCommentDraft,
    deleteCommentDraft,
    saveSummaryDraft,
    sendToAgent,
    updateViewed,
    markCommentsSeen,
  };
}
