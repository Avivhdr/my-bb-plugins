export const INSIGHT_PLUGIN_ID = "github-insight";
export const INSIGHT_METADATA_KEY = "prSummary";
export const SUMMARY_WRITTEN_CHANNEL = "github-insight.summary-written";
const MAX_OPEN_AGE_MS = 60 * 60_000;

const BLOCKERS = [
  "conflicts",
  "checks_failed",
  "checks_waiting",
  "changes_requested",
  "behind",
  "review_required",
  "unresolved_threads",
  "checks_running",
  "draft",
  "blocked",
] as const;
export type BlockerCode = (typeof BLOCKERS)[number];

const STATES = ["open", "draft", "merged", "closed"] as const;
export type PrState = (typeof STATES)[number];

const QUEUE_STATES = ["queued", "awaiting_checks", "merging", "failed"] as const;
export type MergeQueueState = (typeof QUEUE_STATES)[number];
export interface MergeQueue {
  position: number;
  state: MergeQueueState;
}

export interface PrSummary {
  number: number;
  url: string;
  state: PrState;
  failedChecks: number;
  passedChecks: number;
  runningChecks: number;
  waitingChecks: number;
  pendingReviews: number;
  blockers: BlockerCode[];
  failedNames: string[];
  pendingNames: string[];
  mergeQueue: MergeQueue | null;
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const count = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const isBlocker = (value: unknown): value is BlockerCode => BLOCKERS.includes(value as BlockerCode);
const isState = (value: unknown): value is PrState => STATES.includes(value as PrState);
const isQueueState = (value: unknown): value is MergeQueueState =>
  QUEUE_STATES.includes(value as MergeQueueState);

function readMergeQueue(value: unknown): MergeQueue | null {
  const entry = record(value);
  const position = count(entry?.position);
  return position !== null && isQueueState(entry?.state) ? { position, state: entry.state } : null;
}

export function readSummary(value: unknown, now: number): PrSummary | null {
  const summary = record(value);
  const pr = record(summary?.pr),
    checks = record(summary?.checks),
    reviewers = record(summary?.reviewers);
  if (summary?.version !== 1 || !pr || !checks || !reviewers || !isState(pr.state)) return null;
  const number = count(pr.number);
  if (number === null || typeof pr.url !== "string") return null;
  if (pr.state === "open" || pr.state === "draft") {
    const updatedAt = typeof summary.updatedAt === "string" ? Date.parse(summary.updatedAt) : NaN;
    if (!(now - updatedAt <= MAX_OPEN_AGE_MS)) return null;
  }
  const failedChecks = count(checks.failed),
    passedChecks = count(checks.passed),
    runningChecks = count(checks.running),
    pendingReviews = count(reviewers.pending);
  if (
    failedChecks === null ||
    passedChecks === null ||
    runningChecks === null ||
    pendingReviews === null
  )
    return null;
  const blockers = Array.isArray(summary.blockers) ? summary.blockers : [];
  return {
    number,
    url: pr.url,
    state: pr.state,
    failedChecks,
    passedChecks,
    runningChecks,
    waitingChecks: count(checks.waiting) ?? 0,
    pendingReviews,
    blockers: blockers.filter(isBlocker),
    failedNames: strings(checks.failedNames),
    pendingNames: strings(reviewers.pendingNames),
    mergeQueue: pr.state === "open" ? readMergeQueue(summary.mergeQueue) : null,
  };
}
