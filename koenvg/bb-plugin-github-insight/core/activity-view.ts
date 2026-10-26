import { z } from "zod";
import { activityItemSchema } from "./activity";

export const ACTIVITY_UPDATED_CHANNEL = "activity.updated";

const activityViewItemSchema = activityItemSchema.extend({ read: z.boolean() });
export type ActivityViewItem = z.infer<typeof activityViewItemSchema>;

const activityViewPrSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "merged", "closed"]),
  /** You wrote the PR. */
  mine: z.boolean(),
  /** Newest first. */
  items: z.array(activityViewItemSchema),
  unread: z.number(),
});
export type ActivityViewPr = z.infer<typeof activityViewPrSchema>;

export const activityViewSchema = z.object({
  /** PRs with items, the PR with the newest item first. */
  prs: z.array(activityViewPrSchema),
  unread: z.number(),
  /** Lowercase logins whose activity is left out. */
  muted: z.array(z.string()).default([]),
  loadedAt: z.number(),
});
export type ActivityView = z.infer<typeof activityViewSchema>;

export const loadedActivitySchema = z.discriminatedUnion("kind", [
  activityViewSchema.extend({ kind: z.literal("ok") }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    lastGood: activityViewSchema.nullable(),
  }),
]);
export type LoadedActivity = z.infer<typeof loadedActivitySchema>;

export const activityResultSchema = z.union([
  loadedActivitySchema,
  z.object({ kind: z.literal("loading") }),
]);
export type ActivityResult = z.infer<typeof activityResultSchema>;

export function readActivityUpdate(payload: unknown): LoadedActivity | null {
  const parsed = loadedActivitySchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
