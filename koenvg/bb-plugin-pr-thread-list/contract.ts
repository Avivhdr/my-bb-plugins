import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parksSchema, snoozesSchema, summariesSchema, threadId } from "./contract-schemas";

export {
  MAX_SNOOZE_MS,
  PARKS_CHANGED_CHANNEL,
  SNOOZES_CHANGED_CHANNEL,
  type Parks,
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
  listParks: { input: z.object({}).strict(), output: parksSchema },
  park: { input: z.object({ threadId }).strict(), output: z.object({}) },
  unpark: { input: z.object({ threadId }).strict(), output: z.object({}) },
});
