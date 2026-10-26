import { z } from "zod";
import { prKey } from "./pr-ref";
import { parsePrSubject } from "./pr-subject";

export const INSIGHT_UPDATED_CHANNEL = "insight.updated";

const insightUpdatedSchema = z.object({
  threadIds: z.array(z.string()),
  prKeys: z.array(z.string()),
});
export type InsightUpdated = z.infer<typeof insightUpdatedSchema>;

/** Whether an update is for this thread, or for the PR of a PR subject id (core/pr-subject.ts). */
export function mentionsThread(payload: unknown, threadId: string): boolean {
  const parsed = insightUpdatedSchema.pick({ threadIds: true }).safeParse(payload);
  if (parsed.success && parsed.data.threadIds.includes(threadId)) return true;
  const subject = parsePrSubject(threadId);
  return subject !== null && mentionsPr(payload, prKey(subject));
}

export function mentionsPr(payload: unknown, prKey: string): boolean {
  const parsed = insightUpdatedSchema.pick({ prKeys: true }).safeParse(payload);
  return parsed.success && parsed.data.prKeys.includes(prKey);
}
