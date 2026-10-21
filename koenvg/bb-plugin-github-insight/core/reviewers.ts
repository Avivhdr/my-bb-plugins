import { z } from "zod";

const loginActorSchema = z.object({
  __typename: z.enum(["User", "Bot", "Mannequin"]),
  login: z.string(),
});

export const reviewRequestNodeSchema = z.object({
  asCodeOwner: z.boolean(),
  requestedReviewer: z
    .discriminatedUnion("__typename", [
      loginActorSchema,
      z.object({ __typename: z.literal("Team"), slug: z.string() }),
    ])
    .nullable(),
});
export type ReviewRequestNode = z.infer<typeof reviewRequestNodeSchema>;

export const reviewNodeSchema = z.object({
  state: z.enum(["APPROVED", "CHANGES_REQUESTED", "COMMENTED", "DISMISSED", "PENDING"]),
  author: loginActorSchema.nullable(),
});
export type ReviewNode = z.infer<typeof reviewNodeSchema>;

export const reviewerSchema = z.object({
  name: z.string(),
  kind: z.enum(["user", "team", "bot"]),
  state: z.enum(["pending", "approved", "changes_requested", "commented", "dismissed"]),
  codeOwner: z.boolean(),
});
export type Reviewer = z.infer<typeof reviewerSchema>;

export function reviewerKey(reviewer: Pick<Reviewer, "kind" | "name">): string {
  return `${reviewer.kind}:${reviewer.name}`;
}

const REVIEW_STATE: Record<Exclude<ReviewNode["state"], "PENDING">, Reviewer["state"]> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes_requested",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

function actorKind(actor: z.infer<typeof loginActorSchema>): Reviewer["kind"] {
  return actor.__typename === "Bot" ? "bot" : "user";
}

function requestedReviewer(request: ReviewRequestNode): Reviewer | null {
  const reviewer = request.requestedReviewer;
  if (reviewer === null) return null;
  const identity =
    reviewer.__typename === "Team"
      ? { name: reviewer.slug, kind: "team" as const }
      : { name: reviewer.login, kind: actorKind(reviewer) };
  return { ...identity, state: "pending", codeOwner: request.asCodeOwner };
}

function reviewedReviewer(review: ReviewNode): Reviewer | null {
  if (review.author === null || review.state === "PENDING") return null;
  return {
    name: review.author.login,
    kind: actorKind(review.author),
    state: REVIEW_STATE[review.state],
    codeOwner: false,
  };
}

export function buildReviewers(
  requests: readonly ReviewRequestNode[],
  reviews: readonly ReviewNode[],
): Reviewer[] {
  const byKey = new Map<string, Reviewer>();
  const candidates = [...requests.map(requestedReviewer), ...reviews.map(reviewedReviewer)];
  for (const reviewer of candidates) {
    if (reviewer === null) continue;
    const key = reviewerKey(reviewer);
    if (!byKey.has(key)) byKey.set(key, reviewer);
  }
  return [...byKey.values()];
}
