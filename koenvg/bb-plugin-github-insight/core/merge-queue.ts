import { z } from "zod";

export const mergeQueueSchema = z
  .object({
    position: z.number(),
    state: z.enum(["queued", "awaiting_checks", "merging", "failed"]),
  })
  .nullable();
export type MergeQueue = z.infer<typeof mergeQueueSchema>;
type MergeQueueState = NonNullable<MergeQueue>["state"];

export const mergeQueueEntrySchema = z
  .object({
    position: z.number(),
    state: z.enum(["QUEUED", "AWAITING_CHECKS", "MERGEABLE", "LOCKED", "UNMERGEABLE"]),
  })
  .nullable();
type MergeQueueEntry = z.infer<typeof mergeQueueEntrySchema>;

const QUEUE_STATE: Record<NonNullable<MergeQueueEntry>["state"], MergeQueueState> = {
  QUEUED: "queued",
  AWAITING_CHECKS: "awaiting_checks",
  MERGEABLE: "merging",
  LOCKED: "merging",
  UNMERGEABLE: "failed",
};

export function toMergeQueue(entry: MergeQueueEntry): MergeQueue {
  if (entry === null) return null;
  return { position: entry.position, state: QUEUE_STATE[entry.state] };
}
