import type { NewThreadRequest, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AutoReviewSettings } from "../contract";
import type { LinkedQueuePr } from "../core/review-queue-view";

/** The layers whose PRs get a review thread without a click. */
export const AUTO_REVIEW_LAYERS: ReadonlySet<string> = new Set(["Direct", "Teammates"]);

export const MAX_RUNNING_LIMIT = 10;

export const DEFAULT_AUTO_REVIEW: AutoReviewSettings = { enabled: false, maxRunning: 3 };

const SETTINGS_KEY = "auto-review";
const WORKING_DAY_KEY = "working-day";
const STARTED_PREFIX = "auto-review-started:";

const storedSettingsSchema = z.object({
  v: z.literal(1),
  enabled: z.boolean(),
  maxRunning: z.number().int().min(1).max(MAX_RUNNING_LIMIT),
});

export function createAutoReviewSettings(kv: Pick<PluginKvStorage, "get" | "set">) {
  return {
    async get(): Promise<AutoReviewSettings> {
      const entry = storedSettingsSchema.safeParse(await kv.get(SETTINGS_KEY));
      if (!entry.success) return DEFAULT_AUTO_REVIEW;
      return { enabled: entry.data.enabled, maxRunning: entry.data.maxRunning };
    },

    save: ({ enabled, maxRunning }: AutoReviewSettings) =>
      kv.set(SETTINGS_KEY, { v: 1, enabled, maxRunning }),
  };
}

const workingDaySchema = z.object({ v: z.literal(1), day: z.string() });

/** The local day "Working today" was switched on. Auto-review only acts on that day. */
export function createWorkingDay(kv: Pick<PluginKvStorage, "get" | "set" | "delete">) {
  return {
    async get(): Promise<string | null> {
      const entry = workingDaySchema.safeParse(await kv.get(WORKING_DAY_KEY));
      return entry.success ? entry.data.day : null;
    },

    set: (day: string | null) =>
      day === null ? kv.delete(WORKING_DAY_KEY) : kv.set(WORKING_DAY_KEY, { v: 1, day }),
  };
}

/**
 * The PRs that auto-review already started a thread for, as lowercase `owner/repo#n` keys.
 * A PR gets one automatic start: archiving its thread or a failed run does not start another.
 */
export function createAutoStarted(kv: Pick<PluginKvStorage, "get" | "set" | "delete" | "list">) {
  return {
    add: (key: string, threadId: string) => kv.set(`${STARTED_PREFIX}${key}`, { v: 1, threadId }),

    delete: (key: string) => kv.delete(`${STARTED_PREFIX}${key}`),

    async list(): Promise<Set<string>> {
      return new Set(
        (await kv.list(STARTED_PREFIX)).map((key) => key.slice(STARTED_PREFIX.length)),
      );
    },
  };
}

/**
 * Whether auto-review would start a thread for this PR: requested from you or a teammate, open,
 * never reviewed, not ignored or skipped, with a bb project and no thread of any kind yet.
 */
export function isAutoReviewCandidate(pr: LinkedQueuePr): boolean {
  return (
    pr.layer !== null &&
    AUTO_REVIEW_LAYERS.has(pr.layer) &&
    pr.state === "open" &&
    !pr.ignored &&
    pr.skipLabel === null &&
    pr.review === "needs_review" &&
    pr.thread === null &&
    pr.projectIds.length > 0
  );
}

/** How long a PR head stays unchanged before auto-review re-reviews the new commits. */
export const PUSH_SETTLE_MS = 15 * 60_000;

/** What the last review of a PR saw, to tell whether something new asks for a re-review. */
export interface ReReviewBasis {
  /** The later of the reviewed mark and the last re-review. */
  since: number;
  /** The head that review or re-review looked at. */
  reviewedHeadOid: string;
  /** When a queue load first saw the PR's current head, or null if none has. */
  headSeenAt: number | null;
  now: number;
}

/**
 * Whether auto-review would send Re-review to this PR's idle review thread: the same layers and
 * filters as a first review, Re-review is due, and either your review was requested again after
 * the last review, or the head moved since then and has not changed for `PUSH_SETTLE_MS`.
 */
export function isAutoReReviewCandidate(pr: LinkedQueuePr, basis: ReReviewBasis): boolean {
  const eligible =
    pr.layer !== null &&
    AUTO_REVIEW_LAYERS.has(pr.layer) &&
    pr.state === "open" &&
    !pr.ignored &&
    pr.skipLabel === null &&
    pr.reReview &&
    pr.thread?.isReviewThread === true &&
    pr.thread.status === "idle";
  if (!eligible) return false;
  const requestedAt = pr.activity?.lastRequestedAt ?? null;
  const requestedAgain = requestedAt !== null && Date.parse(requestedAt) > basis.since;
  return requestedAgain || pushesSettled(pr.headOid, basis);
}

/** The head moved since the last review and has stayed put long enough to re-review. */
export function pushesSettled(headOid: string, basis: Omit<ReReviewBasis, "since">): boolean {
  return (
    headOid !== basis.reviewedHeadOid &&
    basis.headSeenAt !== null &&
    basis.now - basis.headSeenAt >= PUSH_SETTLE_MS
  );
}

interface BusyThread {
  status: string;
  hasPendingInteraction: boolean;
}

/** A review thread whose agent works: it takes one of the slots. Waiting for you does not. */
export function isBusy(thread: BusyThread): boolean {
  return thread.status !== "idle" && thread.status !== "error" && !thread.hasPendingInteraction;
}

export type ReviewThreadRequest = Pick<NewThreadRequest, "projectId" | "environment" | "input"> &
  Partial<Omit<NewThreadRequest, "projectId" | "environment" | "input">>;

/** What Start review submits with its defaults: a new worktree on the primary host. */
export function autoReviewRequest(
  projectId: string,
  hostId: string,
  prompt: string,
): ReviewThreadRequest {
  return {
    projectId,
    environment: {
      type: "host",
      hostId,
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    },
    input: [{ type: "text", text: prompt, mentions: [] }],
  };
}
