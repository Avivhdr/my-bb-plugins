import type { BlockerCode, MergeQueueState, PrSummary } from "./pr-insight";

type Tone = "neutral" | "waiting" | "problem" | "ready" | "merged";
type Reason =
  | "draft"
  | "merged"
  | "closed"
  | "checks_running"
  | "checks_failed"
  | "checks_waiting"
  | "review"
  | "changes_requested"
  | "unresolved_threads"
  | "conflicts"
  | "behind"
  | "blocked"
  | "ready"
  | "queued"
  | "queue_checks_running"
  | "merging"
  | "queue_failed";

export interface PrMark {
  icon: string;
  count: number | null;
  spin: boolean;
  tone: Tone;
  title: string;
}

export type ChecksState = "passed" | "waiting" | "running" | "failed" | "unknown";

export interface PrView {
  lead: string;
  checks: ChecksState;
  leadTitle: string;
  word: string | null;
  tone: Tone;
  marks: PrMark[];
  label: string;
}

const REASONS: Record<
  Reason,
  {
    status: string;
    tone: Tone;
    lead?: string;
    mark?: string;
    word?: string;
    spin?: true;
    numbered?: true;
  }
> = {
  draft: { status: "draft", tone: "neutral", lead: "GitPullRequestDraft" },
  merged: { status: "merged", tone: "merged", lead: "GitMerge", word: "Merged" },
  closed: { status: "closed", tone: "neutral", lead: "GitPullRequestClosed" },
  checks_running: { status: "checks running", tone: "waiting", mark: "Spinner", spin: true },
  checks_failed: {
    status: "checks failed",
    tone: "problem",
    mark: "CircleX",
    word: "Checks failed",
  },
  checks_waiting: { status: "waiting for you", tone: "waiting", mark: "UserRound" },
  review: { status: "awaiting review", tone: "waiting", mark: "Eye" },
  changes_requested: {
    status: "changes requested",
    tone: "problem",
    mark: "Edit",
    word: "Changes requested",
  },
  unresolved_threads: { status: "unresolved comments", tone: "waiting", mark: "MessageSquare" },
  conflicts: { status: "merge conflicts", tone: "problem", mark: "AlertCircle", word: "Conflicts" },
  behind: { status: "branch out of date", tone: "waiting" },
  blocked: { status: "merge blocked", tone: "problem", mark: "Lock", word: "Blocked" },
  ready: { status: "ready to merge", tone: "ready", word: "Ready" },
  queued: { status: "queued", tone: "waiting", word: "Queued", numbered: true },
  queue_checks_running: {
    status: "queue checks running",
    tone: "waiting",
    mark: "Spinner",
    spin: true,
    word: "Queued",
    numbered: true,
  },
  merging: { status: "merging", tone: "ready", word: "Merging" },
  queue_failed: {
    status: "merge queue failed",
    tone: "problem",
    mark: "CircleX",
    word: "Queue failed",
  },
};

const QUEUE_REASON: Record<MergeQueueState, Reason> = {
  queued: "queued",
  awaiting_checks: "queue_checks_running",
  merging: "merging",
  failed: "queue_failed",
};

const BLOCKER_REASON: Record<BlockerCode, Reason> = {
  conflicts: "conflicts",
  checks_failed: "checks_failed",
  checks_waiting: "checks_waiting",
  changes_requested: "changes_requested",
  blocked: "blocked",
  checks_running: "checks_running",
  review_required: "review",
  unresolved_threads: "unresolved_threads",
  behind: "behind",
  draft: "draft",
};
const REASON_ORDER: Reason[] = [
  "conflicts",
  "checks_failed",
  "checks_waiting",
  "changes_requested",
  "blocked",
  "checks_running",
  "review",
  "unresolved_threads",
  "behind",
  "draft",
];

function reasonsFor(pr: PrSummary): Reason[] {
  if (pr.state !== "open") return [pr.state];
  if (pr.mergeQueue) return [QUEUE_REASON[pr.mergeQueue.state]];
  const named = new Set(pr.blockers.map((code) => BLOCKER_REASON[code]));
  const reasons = REASON_ORDER.filter((reason) => named.has(reason));
  return reasons.length ? reasons : ["ready"];
}

const plural = (value: number, one: string, many: string) => `${value} ${value === 1 ? one : many}`;
const names = (prefix: string, list: string[]) =>
  list.length ? [`${prefix}: ${list.join(", ")}`] : [];
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function numbered(reason: Reason, text: string, pr: PrSummary): string {
  return REASONS[reason].numbered && pr.mergeQueue ? `${text} #${pr.mergeQueue.position}` : text;
}

type Counted = { count: number; text: string; details: string[] };

const COUNTS: Partial<Record<Reason, (pr: PrSummary) => Counted>> = {
  checks_failed: (pr) => ({
    count: pr.failedChecks,
    text: plural(pr.failedChecks, "failed check", "failed checks"),
    details: names("Failed", pr.failedNames),
  }),
  checks_waiting: (pr) => ({
    count: pr.waitingChecks,
    text: plural(pr.waitingChecks, "check waiting for you", "checks waiting for you"),
    details: [],
  }),
  checks_running: (pr) => ({
    count: pr.runningChecks,
    text: plural(pr.runningChecks, "check running", "checks running"),
    details: [],
  }),
  review: (pr) => ({
    count: pr.pendingReviews,
    text: plural(pr.pendingReviews, "review pending", "reviews pending"),
    details: names("Waiting on", pr.pendingNames),
  }),
};

function counted(reason: Reason, pr: PrSummary): Counted | null {
  const found = COUNTS[reason]?.(pr);
  return found && found.count > 0 ? found : null;
}

const CHECKS_TEXT: Record<ChecksState, string | null> = {
  passed: "All checks passed",
  waiting: "Checks waiting for you",
  running: "Checks running",
  failed: "Checks failed",
  unknown: null,
};

function checksState(pr: PrSummary): ChecksState {
  if (pr.state === "merged" || pr.state === "closed") return "unknown";
  if (pr.failedChecks > 0) return "failed";
  if (pr.waitingChecks > 0) return "waiting";
  if (pr.runningChecks > 0) return "running";
  return pr.passedChecks > 0 ? "passed" : "unknown";
}

export function presentPullRequest(pr: PrSummary): PrView {
  const reasons = reasonsFor(pr);
  const firstReason = reasons[0]!;
  const first = REASONS[firstReason];
  const parts = reasons.map((reason) => {
    const { status, tone, mark, spin = false } = REASONS[reason];
    const count = counted(reason, pr);
    const text = count?.text ?? numbered(reason, status, pr);
    return {
      text,
      mark: mark
        ? {
            icon: mark,
            count: count?.count ?? null,
            spin,
            tone,
            title: [sentence(text), ...(count?.details ?? [])].join("\n"),
          }
        : null,
    };
  });
  const checks = checksState(pr);
  return {
    lead: first.lead ?? "GitPullRequest",
    checks,
    leadTitle: [`PR #${pr.number}`, CHECKS_TEXT[checks]].filter(Boolean).join("\n"),
    word: first.word ? numbered(firstReason, first.word, pr) : null,
    tone: first.tone,
    marks: parts.flatMap((part) => (part.mark ? [part.mark] : [])),
    label: `PR #${pr.number}: ${parts.map((part) => part.text).join(", ")}`,
  };
}
