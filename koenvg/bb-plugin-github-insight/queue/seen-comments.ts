import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createKeyedQueue } from "../core/keyed-queue";
import type { PullRequestRef } from "../core/pr-ref";

const seenEntrySchema = z.object({ v: z.literal(1), ids: z.array(z.string()) });

function keyOf({ owner, repo, number }: PullRequestRef): string {
  return `comment-seen:v1:${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

export function createSeenComments(kv: Pick<PluginKvStorage, "get" | "set" | "delete">) {
  const inOrder = createKeyedQueue();

  async function read(key: string): Promise<Set<string>> {
    const entry = seenEntrySchema.safeParse(await kv.get(key));
    return new Set(entry.success ? entry.data.ids : []);
  }

  return {
    get: (pr: PullRequestRef) => read(keyOf(pr)),

    add(pr: PullRequestRef, ids: readonly string[]): Promise<void> {
      const key = keyOf(pr);
      return inOrder(key, async () => {
        const seen = await read(key);
        for (const id of ids) seen.add(id);
        if (seen.size > 0) await kv.set(key, { v: 1, ids: [...seen] });
      });
    },

    delete(pr: PullRequestRef): Promise<void> {
      const key = keyOf(pr);
      return inOrder(key, () => kv.delete(key));
    },
  };
}
