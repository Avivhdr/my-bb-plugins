import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { Summaries } from "./contract";
import { INSIGHT_METADATA_KEY, INSIGHT_PLUGIN_ID } from "./pr-insight";

const PARALLEL_READS = 8;
const LIVE_STATUSES = new Set(["running", "starting", "degraded"]);

type Sdk = Pick<BbPluginApi["sdk"], "threads" | "plugins">;

async function insightAvailable(sdk: Sdk): Promise<boolean> {
  try {
    const plugin = (await sdk.plugins.list()).plugins.find(
      (entry) => entry.id === INSIGHT_PLUGIN_ID,
    );
    return plugin !== undefined && plugin.enabled && LIVE_STATUSES.has(plugin.status);
  } catch {
    // A list we may not read must not hide PR status that github-insight still writes.
    return true;
  }
}

async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await run(items[next++]!);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export async function listSummaries(sdk: Sdk): Promise<Summaries> {
  const [available, threads] = await Promise.all([
    insightAvailable(sdk),
    sdk.threads.list({ archived: false }),
  ]);
  const summaries: Record<string, unknown> = {};
  if (!available) return { insightAvailable: false, summaries };
  await eachLimited(
    threads.filter((thread) => thread.archivedAt === null),
    PARALLEL_READS,
    async ({ id }) => {
      try {
        const metadata = await sdk.threads.getPluginMetadata({
          threadId: id,
          pluginId: INSIGHT_PLUGIN_ID,
        });
        if (metadata[INSIGHT_METADATA_KEY] !== undefined)
          summaries[id] = metadata[INSIGHT_METADATA_KEY];
      } catch {
        /* One unreadable thread must not hide the others. */
      }
    },
  );
  return { insightAvailable: true, summaries };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

export function summariesFingerprint(summaries: Summaries): string {
  return JSON.stringify(canonical(summaries));
}
