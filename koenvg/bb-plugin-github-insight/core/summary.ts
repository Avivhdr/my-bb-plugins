import type { CheckStatus } from "./checks";
import type { PrInsight } from "./overview";
import type { Reviewer } from "./reviewers";

export const SUMMARY_METADATA_KEY = "prSummary";
export const MAX_SUMMARY_BYTES = 4096;
export const SUMMARY_HEARTBEAT_MS = 30 * 60_000;
const MAX_NAMES = 5;
const MAX_TEXT_BYTES = 200;

export type PrSummary = {
  version: 1;
  updatedAt: string;
  pr: { number: number; url: string; state: PrInsight["pr"]["state"] };
  checks: Record<CheckStatus, number> & { failedNames: string[] };
  reviewers: {
    pending: number;
    approved: number;
    changesRequested: number;
    pendingNames: string[];
  };
  blockers: PrInsight["blockers"][number]["code"][];
  mergeQueue: PrInsight["mergeQueue"];
  error: string | null;
};

const encoder = new TextEncoder();

function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

function shorten(text: string): string {
  if (jsonBytes(text) <= MAX_TEXT_BYTES) return text;
  let shortened = "";
  for (const character of text) {
    if (jsonBytes(`${shortened}${character}…`) > MAX_TEXT_BYTES) break;
    shortened += character;
  }
  return `${shortened}…`;
}

function countWhere<T>(items: readonly T[], matches: (item: T) => boolean): number {
  return items.filter(matches).length;
}

function reviewerLabel(reviewer: Reviewer): string {
  return shorten(reviewer.kind === "team" ? `${reviewer.name} (team)` : reviewer.name);
}

export function buildSummary({
  insight,
  refreshedAt,
  error,
}: {
  insight: PrInsight;
  refreshedAt: number;
  error: string | null;
}): PrSummary {
  const { pr, checks, reviewers, blockers, mergeQueue } = insight;
  const countChecks = (status: CheckStatus) =>
    countWhere(checks, (check) => check.status === status);
  const countReviewers = (state: Reviewer["state"]) =>
    countWhere(reviewers, (reviewer) => reviewer.state === state);
  const pending = reviewers.filter((reviewer) => reviewer.state === "pending");

  const summary: PrSummary = {
    version: 1,
    updatedAt: new Date(refreshedAt).toISOString(),
    pr: { number: pr.number, url: pr.url, state: pr.state },
    checks: {
      failed: countChecks("failed"),
      waiting: countChecks("waiting"),
      running: countChecks("running"),
      cancelled: countChecks("cancelled"),
      passed: countChecks("passed"),
      skipped: countChecks("skipped"),
      failedNames: checks
        .filter((check) => check.status === "failed")
        .slice(0, MAX_NAMES)
        .map((check) => shorten(check.name)),
    },
    reviewers: {
      pending: pending.length,
      approved: countReviewers("approved"),
      changesRequested: countReviewers("changes_requested"),
      pendingNames: pending.slice(0, MAX_NAMES).map(reviewerLabel),
    },
    blockers: blockers.map((blocker) => blocker.code),
    mergeQueue,
    error: error === null ? null : shorten(error),
  };

  const bytes = jsonBytes(summary);
  if (bytes >= MAX_SUMMARY_BYTES) {
    throw new Error(`PR summary is ${bytes} bytes, over the ${MAX_SUMMARY_BYTES} byte limit`);
  }
  return summary;
}

export interface WrittenSummary {
  summary: PrSummary;
  writtenAt: number;
}

function withoutTime({ updatedAt: _, ...rest }: PrSummary): string {
  return JSON.stringify(rest);
}

// Dockside drops summaries older than 1 hour, so a newer refresh time is
// rewritten now and then even when the data did not change.
export function shouldWriteSummary(
  previous: WrittenSummary | undefined,
  next: PrSummary,
  now: number,
): boolean {
  if (previous === undefined) return true;
  if (withoutTime(previous.summary) !== withoutTime(next)) return true;
  return (
    previous.summary.updatedAt !== next.updatedAt &&
    now - previous.writtenAt >= SUMMARY_HEARTBEAT_MS
  );
}
