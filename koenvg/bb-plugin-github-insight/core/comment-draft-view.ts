import type { ListedCommentDraft } from "./review-drafts";

export function draftLineText({
  line,
  startLine,
}: Pick<ListedCommentDraft, "line" | "startLine">): string {
  return startLine === null ? `Line ${line}` : `Lines ${startLine}-${line}`;
}

export function newCommitsText(draftOid: string, headOid: string): string {
  return `PR has new commits since these drafts (${shortOid(draftOid)} -> ${shortOid(headOid)})`;
}

function shortOid(oid: string): string {
  return oid.slice(0, 7);
}
