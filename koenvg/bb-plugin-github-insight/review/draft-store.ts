import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { draftSchema, type Draft, type Drafts } from "../core/drafts";
import { prKey, type PullRequestRef } from "../core/pr-ref";
import {
  commentDraftEntry,
  readCommentDraft,
  readSummaryDraft,
  summaryDraftEntry,
  type CommentDraft,
  type ListedCommentDraft,
  type SummaryDraft,
} from "../core/review-drafts";
import type { CollectedReviewThreads } from "../core/review-threads";

export type DraftStore = ReturnType<typeof createDraftStore>;
export type CommentEdit = Pick<CommentDraft, "body" | "updatedAt" | "source">;

function prefixOf(pr: PullRequestRef): string {
  return `draft:${prKey(pr)}:`;
}

function commentPrefixOf(pr: PullRequestRef): string {
  return `comment:${prKey(pr)}:`;
}

function summaryKeyOf(pr: PullRequestRef): string {
  return `summary:${prKey(pr)}`;
}

function byPosition(a: ListedCommentDraft, b: ListedCommentDraft): number {
  return a.path.localeCompare(b.path) || a.line - b.line || a.id.localeCompare(b.id);
}

async function draftRows(kv: PluginKvStorage, pr: PullRequestRef) {
  const prefix = prefixOf(pr);
  return Promise.all(
    (await kv.list(prefix)).map(async (key) => ({
      key,
      reviewThreadId: key.slice(prefix.length),
      draft: draftSchema.safeParse(await kv.get(key)),
    })),
  );
}

function splitDrafts(
  rows: Awaited<ReturnType<typeof draftRows>>,
  { threads, complete }: CollectedReviewThreads,
) {
  const resolvedById = new Map(threads.map((thread) => [thread.id, thread.resolved]));
  const drafts: Drafts = {};
  const staleKeys: string[] = [];
  for (const { key, reviewThreadId, draft } of rows) {
    const resolved = resolvedById.get(reviewThreadId);
    if (!draft.success || resolved === true || (resolved === undefined && complete))
      staleKeys.push(key);
    else if (resolved === false) drafts[reviewThreadId] = draft.data;
  }
  return { drafts, staleKeys };
}

export function createDraftStore(kv: PluginKvStorage) {
  return {
    save: (pr: PullRequestRef, reviewThreadId: string, draft: Draft) =>
      kv.set(prefixOf(pr) + reviewThreadId, draft),

    delete: (pr: PullRequestRef, reviewThreadId: string) =>
      kv.delete(prefixOf(pr) + reviewThreadId),

    async liveDrafts(pr: PullRequestRef, collected: CollectedReviewThreads): Promise<Drafts> {
      const { drafts, staleKeys } = splitDrafts(await draftRows(kv, pr), collected);
      await Promise.all(staleKeys.map((key) => kv.delete(key)));
      return drafts;
    },

    knownDrafts: async (pr: PullRequestRef, collected: CollectedReviewThreads) =>
      splitDrafts(await draftRows(kv, pr), collected).drafts,

    saveComment: (pr: PullRequestRef, draftId: string, draft: CommentDraft) =>
      kv.set(commentPrefixOf(pr) + draftId, commentDraftEntry(draft)),

    comment: async (pr: PullRequestRef, draftId: string) =>
      readCommentDraft(await kv.get(commentPrefixOf(pr) + draftId)),

    async editComment(pr: PullRequestRef, draftId: string, edit: CommentEdit): Promise<boolean> {
      const key = commentPrefixOf(pr) + draftId;
      const draft = readCommentDraft(await kv.get(key));
      if (draft === null) return false;
      await kv.set(key, commentDraftEntry({ ...draft, ...edit }));
      return true;
    },

    deleteComment: (pr: PullRequestRef, draftId: string) =>
      kv.delete(commentPrefixOf(pr) + draftId),

    async comments(pr: PullRequestRef): Promise<ListedCommentDraft[]> {
      const prefix = commentPrefixOf(pr);
      const listed = await Promise.all(
        (await kv.list(prefix)).map(async (key) => {
          const draft = readCommentDraft(await kv.get(key));
          return draft === null ? null : { id: key.slice(prefix.length), ...draft };
        }),
      );
      return listed.filter((draft) => draft !== null).sort(byPosition);
    },

    saveSummary: (pr: PullRequestRef, draft: SummaryDraft) =>
      kv.set(summaryKeyOf(pr), summaryDraftEntry(draft)),

    summary: async (pr: PullRequestRef) => readSummaryDraft(await kv.get(summaryKeyOf(pr))),

    async deleteReviewDrafts(pr: PullRequestRef) {
      const keys = [...(await kv.list(commentPrefixOf(pr))), summaryKeyOf(pr)];
      await Promise.all(keys.map((key) => kv.delete(key)));
    },
  };
}
