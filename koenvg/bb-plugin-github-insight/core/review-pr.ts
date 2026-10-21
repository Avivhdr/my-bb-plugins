import { z } from "zod";

export const REVIEW_PR_METADATA_KEY = "review-pr";

export const reviewPrSchema = z.object({
  repo: z.string().min(1),
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string(),
});
export type ReviewPr = z.infer<typeof reviewPrSchema>;

const reviewPrEntrySchema = reviewPrSchema.extend({ v: z.literal(1) });

export function reviewPrMetadata(pr: ReviewPr) {
  const { repo, number, title, url } = pr;
  return { [REVIEW_PR_METADATA_KEY]: { v: 1, repo, number, title, url } };
}

export function readReviewPr(metadata: unknown): ReviewPr | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const parsed = reviewPrEntrySchema.safeParse(
    (metadata as Record<string, unknown>)[REVIEW_PR_METADATA_KEY],
  );
  if (!parsed.success) return null;
  const { v: _, ...pr } = parsed.data;
  return pr;
}
