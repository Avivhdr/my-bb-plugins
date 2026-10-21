import { z } from "zod";
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

export const queueRowSchema = queuePrSchema.extend({ requested: z.boolean() });
export type QueueRow = z.infer<typeof queueRowSchema>;

const linkedQueuePrSchema = queueRowSchema.extend({
  projectIds: z.array(z.string()),
  review: reviewStateSchema,
  newActivity: z.array(newActivitySchema).default([]),
  thread: linkedThreadSchema.nullable(),
});
export type LinkedQueuePr = z.infer<typeof linkedQueuePrSchema>;

export function isReviewed(pr: LinkedQueuePr): boolean {
  return pr.review === "reviewed" && pr.newActivity.length === 0;
}

const queueSectionSchema = z.array(
  z.object({ repo: z.string(), prs: z.array(linkedQueuePrSchema) }),
);
export type QueueSection = z.infer<typeof queueSectionSchema>;

export const reviewQueueViewSchema = z.object({
  needsReview: queueSectionSchema,
  reviewed: queueSectionSchema,
  truncated: z.boolean(),
  loadedAt: z.number(),
  hasUnseen: z.boolean().default(false),
  hasReturned: z.boolean().default(false),
});
export type ReviewQueueView = z.infer<typeof reviewQueueViewSchema>;

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
