import type { ListedCommentDraft } from "./review-drafts";

export function splitByCommit(
  drafts: readonly ListedCommentDraft[],
  headOid: string,
): { atHead: ListedCommentDraft[]; older: ListedCommentDraft[] } {
  return {
    atHead: drafts.filter((draft) => draft.commitOid === headOid),
    older: drafts.filter((draft) => draft.commitOid !== headOid),
  };
}

export type OneCommitCheck = { ok: true } | { ok: false; message: string };

export function checkOneCommit(
  drafts: readonly ListedCommentDraft[],
  headOid: string,
): OneCommitCheck {
  const { older } = splitByCommit(drafts, headOid);
  if (older.length === 0) return { ok: true };
  const commits = [...new Set(older.map((draft) => draft.commitOid))].join(", ");
  const subject = older.length === 1 ? "1 comment draft is" : `${older.length} comment drafts are`;
  return { ok: false, message: `${subject} at commit ${commits}, but the PR head is ${headOid}` };
}

export type DraftsCommit = { ok: true; value: string } | { ok: false; message: string };

export function draftsCommit(drafts: readonly ListedCommentDraft[], headOid: string): DraftsCommit {
  const commits = [...new Set(drafts.map(({ commitOid }) => commitOid))];
  if (commits.length > 1) {
    return {
      ok: false,
      message: `Comment drafts are on more than one commit (${commits.join(", ")}). Delete the older ones.`,
    };
  }
  return { ok: true, value: commits[0] ?? headOid };
}
