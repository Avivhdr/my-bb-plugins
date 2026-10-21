import { z } from "zod";

export const INSIGHT_UPDATED_CHANNEL = "insight.updated";

const insightUpdatedSchema = z.object({
  threadIds: z.array(z.string()),
  prKeys: z.array(z.string()),
});
export type InsightUpdated = z.infer<typeof insightUpdatedSchema>;

export function mentionsThread(payload: unknown, threadId: string): boolean {
  const parsed = insightUpdatedSchema.pick({ threadIds: true }).safeParse(payload);
  return parsed.success && parsed.data.threadIds.includes(threadId);
}

export function mentionsPr(payload: unknown, prKey: string): boolean {
  const parsed = insightUpdatedSchema.pick({ prKeys: true }).safeParse(payload);
  return parsed.success && parsed.data.prKeys.includes(prKey);
}
