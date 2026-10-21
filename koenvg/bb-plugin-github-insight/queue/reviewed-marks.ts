import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PullRequestRef } from "../core/pr-ref";

const PREFIX = "reviewed:";

const markEntrySchema = z.object({
  v: z.literal(1),
  owner: z.string(),
  repo: z.string(),
  number: z.number(),
  headOid: z.string(),
  markedAt: z.number(),
});

export interface ReviewedMark {
  ref: PullRequestRef;
  headOid: string;
  markedAt: number;
}

export type ReviewedMarks = ReturnType<typeof createReviewedMarks>;

function markOf(stored: unknown): ReviewedMark | null {
  const entry = markEntrySchema.safeParse(stored);
  if (!entry.success) return null;
  const { owner, repo, number, headOid, markedAt } = entry.data;
  return { ref: { owner, repo, number }, headOid, markedAt };
}

function keyOf({ owner, repo, number }: PullRequestRef): string {
  return `${PREFIX}${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

export function createReviewedMarks(
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
        markedAt: now(),
      }),

    delete: (ref: PullRequestRef) => kv.delete(keyOf(ref)),

    get: async (ref: PullRequestRef) => markOf(await kv.get(keyOf(ref))),

    async list(): Promise<ReviewedMark[]> {
      const marks = await Promise.all(
        (await kv.list(PREFIX)).map(async (key) => markOf(await kv.get(key))),
      );
      return marks.filter((mark) => mark !== null);
    },
  };
}
