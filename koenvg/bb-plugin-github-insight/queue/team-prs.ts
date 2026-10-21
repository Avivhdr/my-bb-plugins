import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PullRequestRef } from "../core/pr-ref";
import type { TeamScan } from "../core/team-prs";

const KEY = "team-prs";

const refSchema = z.object({ owner: z.string(), repo: z.string(), number: z.number() });

const teamPrsEntrySchema = z.object({
  v: z.literal(1),
  refs: z.array(refSchema),
  scannedThrough: z.record(z.string(), z.string()),
});

export type TeamPrs = Omit<z.infer<typeof teamPrsEntrySchema>, "v">;

function teamPrKey({ owner, repo, number }: PullRequestRef): string {
  return `${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`;
}

function lowercased({ owner, repo, number }: PullRequestRef): PullRequestRef {
  return { owner: owner.toLowerCase(), repo: repo.toLowerCase(), number };
}

export function createTeamPrs(kv: Pick<PluginKvStorage, "get" | "set">) {
  async function read(): Promise<TeamPrs> {
    const entry = teamPrsEntrySchema.safeParse(await kv.get(KEY));
    return entry.success ? entry.data : { refs: [], scannedThrough: {} };
  }

  function write({ refs, scannedThrough }: TeamPrs): Promise<void> {
    return kv.set(KEY, { v: 1, refs, scannedThrough });
  }

  return {
    read,

    async recordScan(scan: TeamScan): Promise<void> {
      const { refs } = await read();
      const byKey = new Map(refs.map((ref) => [teamPrKey(ref), ref]));
      for (const ref of scan.refs) {
        if (!byKey.has(teamPrKey(ref))) byKey.set(teamPrKey(ref), lowercased(ref));
      }
      await write({ refs: [...byKey.values()], scannedThrough: scan.scannedThrough });
    },

    async remove(gone: readonly PullRequestRef[]): Promise<void> {
      const removed = new Set(gone.map(teamPrKey));
      const stored = await read();
      if (!stored.refs.some((ref) => removed.has(teamPrKey(ref)))) return;
      await write({ ...stored, refs: stored.refs.filter((ref) => !removed.has(teamPrKey(ref))) });
    },
  };
}
