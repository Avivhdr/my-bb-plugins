import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";

const KEY = "review-ignored";

const ignoredEntrySchema = z.object({ v: z.literal(1), keys: z.array(z.string()) });

/** PRs ignored one at a time, as lowercase `owner/repo#n` keys. */
export function createIgnoredPrs(kv: Pick<PluginKvStorage, "get" | "set">) {
  async function list(): Promise<Set<string>> {
    const entry = ignoredEntrySchema.safeParse(await kv.get(KEY));
    return new Set(entry.success ? entry.data.keys : []);
  }

  async function update(change: (keys: Set<string>) => void): Promise<void> {
    const keys = await list();
    change(keys);
    await kv.set(KEY, { v: 1, keys: [...keys] });
  }

  return {
    list,
    add: (key: string) => update((keys) => keys.add(key)),
    remove: (removed: readonly string[]) =>
      update((keys) => removed.forEach((key) => keys.delete(key))),
  };
}
