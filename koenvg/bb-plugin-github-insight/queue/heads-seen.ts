import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

const PREFIX = "head-seen:";

const entrySchema = z.object({ v: z.literal(1), headOid: z.string(), seenAt: z.number() });

/** The head of a PR and when a queue load first saw it, keyed by lowercase `owner/repo#n`. */
export interface SeenHead {
  headOid: string;
  seenAt: number;
}

/**
 * When each reviewed PR's current head first showed up, so auto-review can wait for the
 * author's pushes to settle before it sends Re-review.
 */
export function createHeadsSeen(kv: Pick<PluginKvStorage, "get" | "set" | "delete" | "list">) {
  return {
    set: (key: string, head: SeenHead) => kv.set(`${PREFIX}${key}`, { v: 1, ...head }),

    delete: (key: string) => kv.delete(`${PREFIX}${key}`),

    async list(): Promise<Map<string, SeenHead>> {
      const keys = await kv.list(PREFIX);
      const entries = await Promise.all(
        keys.map(async (key) => {
          const entry = entrySchema.safeParse(await kv.get(key));
          if (!entry.success) return null;
          const { headOid, seenAt } = entry.data;
          return [key.slice(PREFIX.length), { headOid, seenAt }] as const;
        }),
      );
      return new Map(entries.filter((entry) => entry !== null));
    },
  };
}
