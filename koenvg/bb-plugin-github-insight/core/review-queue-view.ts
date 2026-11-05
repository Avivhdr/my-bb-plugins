import { z } from "zod";
import { teammateFilterSchema } from "./review-filters";
import { queuePrSchema } from "./review-queue";
import { reviewStateSchema } from "./review-state";

export const reviewThreadStatusSchema = z.enum(["running", "needs_you", "idle", "error"]);
export type ReviewThreadStatus = z.infer<typeof reviewThreadStatusSchema>;

export const returnedReasonSchema = z.enum(["finished", "failed", "needs_you"]);
export type ReturnedReason = z.infer<typeof returnedReasonSchema>;

const linkedThreadSchema = z.object({
  id: z.string(),
  status: reviewThreadStatusSchema,
  isReviewThread: z.boolean(),
  returned: returnedReasonSchema.nullable().default(null),
});
export type LinkedThread = z.infer<typeof linkedThreadSchema>;

export const newActivitySchema = z.enum(["new_comments", "requested_again"]);
export type NewActivity = z.infer<typeof newActivitySchema>;

/** A PR as fetched, with the layer whose search found it, or null for a tracked PR. */
export const queueRowSchema = queuePrSchema.extend({ layer: z.string().nullable() });
export type QueueRow = z.infer<typeof queueRowSchema>;

const linkedQueuePrSchema = queueRowSchema.extend({
  projectIds: z.array(z.string()),
  review: reviewStateSchema,
  newActivity: z.array(newActivitySchema).default([]),
  thread: linkedThreadSchema.nullable(),
  /** Re-review can send a follow-up to the review thread: something changed since the last review or re-review. */
  reReview: z.boolean().default(false),
  /** The label that keeps this PR out of the counts, e.g. "DO NOT REVIEW". */
  skipLabel: z.string().nullable().default(null),
  ignored: z.boolean().default(false),
  /** Auto-review starts a thread for this PR when a slot frees up. */
  autoQueued: z.boolean().default(false),
});
export type LinkedQueuePr = z.infer<typeof linkedQueuePrSchema>;

export function isReviewed(pr: LinkedQueuePr): boolean {
  return pr.review === "reviewed" && pr.newActivity.length === 0;
}

const queueSectionSchema = z.array(
  z.object({ repo: z.string(), prs: z.array(linkedQueuePrSchema) }),
);
export type QueueSection = z.infer<typeof queueSectionSchema>;

const queueLayerSchema = z.object({
  name: z.string(),
  prs: queueSectionSchema,
  /** PRs that wait for you here: skipped PRs are listed but not counted. */
  count: z.number(),
  truncated: z.boolean(),
  /** Repos hidden from this layer only. */
  hiddenRepos: z.array(z.string()),
  teammates: teammateFilterSchema.nullable().default(null),
});
export type QueueLayer = z.infer<typeof queueLayerSchema>;

export const reviewQueueViewSchema = z.object({
  layers: z.array(queueLayerSchema),
  reviewed: queueSectionSchema,
  merged: queueSectionSchema,
  ignored: queueSectionSchema,
  /** Repos hidden from every layer. */
  hiddenEverywhere: z.array(z.string()),
  /** The team, as `org/slug`, whose members are your teammates. */
  teammatesTeam: z.string().nullable().default(null),
  /** Why the members of that team could not be read in the last load. */
  teammatesError: z.string().nullable().default(null),
  loadedAt: z.number(),
  hasUnseen: z.boolean().default(false),
  hasReturned: z.boolean().default(false),
});
export type ReviewQueueView = z.infer<typeof reviewQueueViewSchema>;

export function viewSections(view: ReviewQueueView): QueueSection[] {
  return [...view.layers.map((layer) => layer.prs), view.reviewed, view.merged, view.ignored];
}

export function viewPrs(view: ReviewQueueView): LinkedQueuePr[] {
  return viewSections(view).flatMap((section) => section.flatMap((group) => group.prs));
}

/** The PRs of a layer that count, without the skipped ones. */
export function countedPrs(layer: QueueLayer): LinkedQueuePr[] {
  return layer.prs.flatMap((group) => group.prs).filter((pr) => pr.skipLabel === null);
}

export const loadedReviewQueueSchema = z.discriminatedUnion("kind", [
  reviewQueueViewSchema.extend({ kind: z.literal("ok") }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    lastGood: reviewQueueViewSchema.nullable(),
  }),
]);
export type LoadedReviewQueue = z.infer<typeof loadedReviewQueueSchema>;

export const reviewQueueResultSchema = z.union([
  loadedReviewQueueSchema,
  z.object({ kind: z.literal("loading") }),
]);
export type ReviewQueueResult = z.infer<typeof reviewQueueResultSchema>;
