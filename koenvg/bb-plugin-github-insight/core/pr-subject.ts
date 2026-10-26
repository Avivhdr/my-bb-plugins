import type { PullRequestRef } from "./pr-ref";

/**
 * The PR views take a thread id. A PR without a thread uses `pr:<owner>/<repo>#<n>` in its place,
 * and the server reads that PR through the primary host.
 */
const PREFIX = "pr:";
const SUBJECT = /^pr:([^/#\s]+)\/([^/#\s]+)#([1-9]\d*)$/;

export function prSubjectId({ owner, repo, number }: PullRequestRef): string {
  return `${PREFIX}${owner}/${repo}#${number}`;
}

export function isPrSubject(id: string): boolean {
  return id.startsWith(PREFIX);
}

export function parsePrSubject(id: string): PullRequestRef | null {
  const match = SUBJECT.exec(id);
  if (match === null) return null;
  return { owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}
