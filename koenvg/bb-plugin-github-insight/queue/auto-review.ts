import type { NewThreadRequest, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { AutoReviewSettings } from "../contract";
import type { LinkedQueuePr } from "../core/review-queue-view";

/** The layers whose PRs get a review thread without a click. */
export const AUTO_REVIEW_LAYERS: ReadonlySet<string> = new Set(["Direct", "Teammates"]);

export const MAX_RUNNING_LIMIT = 10;

export const DEFAULT_AUTO_REVIEW: AutoReviewSettings = { enabled: false, maxRunning: 3 };

const SETTINGS_KEY = "auto-review";
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
