import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

const KEY = "review-seen";

const seenEntrySchema = z.object({ v: z.literal(1), keys: z.array(z.string()) });

export function createSeenPrs(kv: Pick<PluginKvStorage, "get" | "set">) {
  return {
    async list(): Promise<Set<string>> {
      const entry = seenEntrySchema.safeParse(await kv.get(KEY));
      return new Set(entry.success ? entry.data.keys : []);
    },

    replace: (keys: string[]) => kv.set(KEY, { v: 1, keys }),

    async remove(keys: string[]): Promise<void> {
      const entry = seenEntrySchema.safeParse(await kv.get(KEY));
      if (!entry.success) return;
      const removed = new Set(keys);
      await kv.set(KEY, { v: 1, keys: entry.data.keys.filter((key) => !removed.has(key)) });
    },
  };
}
