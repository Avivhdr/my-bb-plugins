import { z } from "zod";
import { prStateSchema } from "./review-submit";

const viewerReviewStateSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "COMMENTED",
  "DISMISSED",
  "PENDING",
]);

const latestReviewSchema = z
  .object({
    state: viewerReviewStateSchema,
    submittedAt: z.string().nullable(),
    commit: z.object({ oid: z.string() }).nullable(),
  })
  .nullish();

const prHeadResponseSchema = z.object({
  data: z.object({
    repository: z.object({
      pullRequest: z.object({
        id: z.string(),
        headRefOid: z.string(),
        state: prStateSchema,
        viewerDidAuthor: z.boolean(),
        viewerLatestReview: latestReviewSchema,
      }),
    }),
  }),
});

export const viewerReviewSchema = z.object({
  state: viewerReviewStateSchema.exclude(["PENDING"]),
  submittedAt: z.string(),
  commitOid: z.string().nullable(),
});
export type ViewerReview = z.infer<typeof viewerReviewSchema>;

export const prHeadSchema = z.object({
  prNodeId: z.string(),
  oid: z.string(),
  state: prStateSchema,
  viewerIsAuthor: z.boolean(),
  viewerReview: viewerReviewSchema.nullable(),
});
export type PrHead = z.infer<typeof prHeadSchema>;

export function parsePrHead(response: unknown): PrHead {
  const { id, headRefOid, state, viewerDidAuthor, viewerLatestReview } =
    prHeadResponseSchema.parse(response).data.repository.pullRequest;
  return {
    prNodeId: id,
    oid: headRefOid,
    state,
    viewerIsAuthor: viewerDidAuthor,
    viewerReview: submittedReview(viewerLatestReview),
  };
}

function submittedReview(review: z.infer<typeof latestReviewSchema>): ViewerReview | null {
  if (!review || review.state === "PENDING" || review.submittedAt === null) return null;
  return {
    state: review.state,
    submittedAt: review.submittedAt,
    commitOid: review.commit?.oid ?? null,
  };
}
