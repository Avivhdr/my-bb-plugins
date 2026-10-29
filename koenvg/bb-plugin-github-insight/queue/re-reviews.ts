import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PullRequestRef } from "../core/pr-ref";

const PREFIX = "re-review:";

const entrySchema = z.object({
  v: z.literal(1),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  headOid: z.string(),
  sentAt: z.number(),
});

/** The PR head and time at which Re-review last sent its prompt to the review thread. */
export interface SentReReview {
  ref: PullRequestRef;
  headOid: string;
  sentAt: number;
}

function sentOf(stored: unknown): SentReReview | null {
  const entry = entrySchema.safeParse(stored);
  if (!entry.success) return null;
  const { owner, repo, number, headOid, sentAt } = entry.data;
  return { ref: { owner, repo, number }, headOid, sentAt };
}

function keyOf({ owner, repo, number }: PullRequestRef): string {
  return `${PREFIX}${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

export function createReReviews(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete" | "list">,
  now: () => number,
) {
  return {
    save: (ref: PullRequestRef, headOid: string) =>
      kv.set(keyOf(ref), {
        v: 1,
        owner: ref.owner.toLowerCase(),
        repo: ref.repo.toLowerCase(),
        number: ref.number,
        headOid,
        sentAt: now(),
      }),

    delete: (ref: PullRequestRef) => kv.delete(keyOf(ref)),

    async list(): Promise<SentReReview[]> {
      const sent = await Promise.all(
        (await kv.list(PREFIX)).map(async (key) => sentOf(await kv.get(key))),
      );
      return sent.filter((entry) => entry !== null);
    },
  };
}
