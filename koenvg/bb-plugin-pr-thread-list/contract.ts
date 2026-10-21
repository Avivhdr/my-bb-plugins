import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { snoozesSchema, summariesSchema, threadId } from "./contract-schemas";

export {
  MAX_SNOOZE_MS,
  SNOOZES_CHANGED_CHANNEL,
  type Snoozes,
  type Summaries,
} from "./contract-schemas";

export const rpcContract = defineRpcContract({
  listSummaries: { input: z.object({}).strict(), output: summariesSchema },
  listSnoozes: { input: z.object({}).strict(), output: snoozesSchema },
  snooze: {
    input: z.object({ threadId, wakeAt: z.number().int() }).strict(),
    output: z.object({}),
  },
  wake: { input: z.object({ threadId }).strict(), output: z.object({}) },
});
