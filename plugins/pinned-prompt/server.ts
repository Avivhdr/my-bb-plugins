import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const promptSchema = z.object({
  rowId: z.string(),
  /** Position of the prompt's row in `rowIds`. */
  index: z.number().int().nonnegative(),
  text: z.string(),
  /** Turns from this prompt up to the next one. The page names some rows only by turn. */
  turnIds: z.array(z.string()),
});
export type Prompt = z.infer<typeof promptSchema>;

const promptsSchema = z.object({
  /** Every top-level timeline row id, in display order. */
  rowIds: z.array(z.string()),
  /** The user's own messages, in display order. */
  prompts: z.array(promptSchema),
});
export type Prompts = z.infer<typeof promptsSchema>;

// app.tsx imports only the type of this contract, so the frontend bundle never
// pulls in "@get-bb/plugin-sdk", which bb does not provide to frontends.
export const rpcContract = defineRpcContract({
  prompts: {
    input: z.object({ threadId: z.string().regex(/^thr_[a-z0-9]+$/) }),
    output: promptsSchema,
  },
});

/** The most turns bb returns from one timeline call. */
const SEGMENT_LIMIT = "100";

export default function plugin(bb: BbPluginApi) {
  bb.rpc.register(rpcContract, {
    prompts: async ({ threadId }) => {
      const { rows } = await bb.sdk.threads.timeline({ threadId, segmentLimit: SEGMENT_LIMIT });
      const rowIds: string[] = [];
      const prompts: Prompt[] = [];
      for (const row of rows) {
        const index = rowIds.push(row.id) - 1;
        if (row.kind === "conversation" && row.role === "user" && row.initiator === "user") {
          prompts.push({ rowId: row.id, index, text: row.text, turnIds: [] });
        }
        const turnIds = prompts.at(-1)?.turnIds;
        if (row.turnId && turnIds && !turnIds.includes(row.turnId)) turnIds.push(row.turnId);
      }
      return { rowIds, prompts };
    },
  });
}
