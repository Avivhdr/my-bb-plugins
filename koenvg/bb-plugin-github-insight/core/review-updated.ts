import { z } from "zod";

export const REVIEW_UPDATED_CHANNEL = "review.updated";
export const REVIEW_DRAFTS_UPDATED_CHANNEL = "review.drafts-updated";

const reviewUpdatedSchema = z.object({ threadId: z.string() });
export type ReviewUpdated = z.infer<typeof reviewUpdatedSchema>;

export function isReviewUpdateFor(payload: unknown, threadId: string): boolean {
  const parsed = reviewUpdatedSchema.safeParse(payload);
  return parsed.success && parsed.data.threadId === threadId;
}
