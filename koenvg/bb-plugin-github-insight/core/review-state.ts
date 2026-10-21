import { z } from "zod";

export const reviewStateSchema = z.enum(["needs_review", "updated_since_review", "reviewed"]);
export type ReviewState = z.infer<typeof reviewStateSchema>;

export function reviewState(reviewedHeadOid: string | null, headOid: string): ReviewState {
  if (reviewedHeadOid === null) return "needs_review";
  return reviewedHeadOid === headOid ? "reviewed" : "updated_since_review";
}
