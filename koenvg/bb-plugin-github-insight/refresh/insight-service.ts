import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { InsightResult } from "../contract";
import { prInsightSchema, type PrInsight, type PrReading } from "../core/overview";
import { prKey, type PullRequestRef } from "../core/pr-ref";
import {
  buildSummary,
  shouldWriteSummary,
  type PrSummary,
  type WrittenSummary,
} from "../core/summary";
import { GhFailureError, RATE_LIMITED_TEXT } from "../github/gh-failure";
import type { LookupOptions, PrResolution, PrTarget } from "../pr-lookup";
import type { RateLimitPause } from "../github/rate-limit-pause";
import type { InsightUpdated } from "../core/insight-updated";

export const POLL_INTERVAL_MS = 60_000;
export const MAX_PARALLEL_REFRESHES = 4;
export const IDLE_RETRY_MS = 10_000;
export const STORED_READING_PREFIX = "insight:";
export const NO_PRIMARY_HOST_TEXT = "No host to read GitHub from";
const FRESH: LookupOptions = { fresh: true };

const storedReadingSchema = z.object({
  v: z.literal(1),
  refreshedAt: z.number(),
  reading: z.object({ insight: prInsightSchema, pullRequestId: z.string() }),
});

export interface ThreadRef {
  id: string;
  environmentId: string | null;
}

export interface InsightServiceDeps {
  listThreads(): Promise<ThreadRef[]>;
  resolvePr(threadId: string, options?: LookupOptions): Promise<PrResolution>;
  resolveEnvironmentPr(environmentId: string): Promise<PrResolution>;
  fetchInsight(target: PrTarget): Promise<PrReading>;
  primaryHostId(): Promise<string | null>;
  publish(update: InsightUpdated): void;
  writeSummary(threadId: string, summary: PrSummary): Promise<void>;
  removeSummary(threadId: string): Promise<void>;
  kv: Pick<PluginKvStorage, "get" | "set" | "delete" | "list">;
  pause: RateLimitPause;
  warn(message: string): void;
}

type CacheEntry = (
  | { good: PrReading & { refreshedAt: number }; error: string | null }
  | { good: null; error: string }
) & { summaryError: string | null; threadIds: Set<string>; fromStorage?: true };

export type CachedPr =
  | Exclude<PrResolution, { kind: "pr" }>
  | { kind: "not_cached" }
  | { kind: "cached"; target: PrTarget; insight: PrInsight; pullRequestId: string };

interface PrGroup {
  target: PrTarget;
  threadIds: Set<string>;
}

interface ThreadsByPr {
  groups: PrGroup[];
  threadIdsWithoutPr: string[];
  everyPrResolved: boolean;
}

function storedReadingKey(key: string): string {
  return `${STORED_READING_PREFIX}${key}`;
}

function toResult(entry: CacheEntry): InsightResult {
  if (entry.good === null) return { kind: "error", message: entry.error };
  const { insight, refreshedAt } = entry.good;
  return { kind: "ok", insight, refreshedAt, error: entry.error };
}

function sameData(previous: CacheEntry | undefined, next: CacheEntry): boolean {
  if (previous === undefined) return false;
  const data = (entry: CacheEntry) =>
    JSON.stringify({ insight: entry.good?.insight ?? null, error: entry.error });
  return data(previous) === data(next);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Other plugins and agents can read the summary, so it gets a fixed text
// instead of raw gh stderr.
function summaryErrorText(error: unknown): string {
  return error instanceof GhFailureError && error.failure.kind !== "failed"
    ? error.message
    : "refresh failed";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

async function forEachLimited<T>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, worker));
}

export function createInsightService(deps: InsightServiceDeps) {
  const entries = new Map<string, CacheEntry>();
  const running = new Map<string, { group: PrGroup; done: Promise<CacheEntry> }>();
  const writtenSummaries = new Map<string, WrittenSummary>();
  const removedSummaries = new Set<string>();
  const { isPaused } = deps.pause;

  function pauseAfter(error: unknown) {
    if (error instanceof GhFailureError && error.failure.kind === "rate_limited") {
      deps.pause.pauseUntilReset(error.failure.resetAt);
    }
  }

  async function writeSummaries(summary: PrSummary, threadIds: Iterable<string>) {
    const now = Date.now();
    await Promise.all(
      [...threadIds].map(async (threadId) => {
        if (!shouldWriteSummary(writtenSummaries.get(threadId), summary, now)) return;
        try {
          await deps.writeSummary(threadId, summary);
          writtenSummaries.set(threadId, { summary, writtenAt: now });
          removedSummaries.delete(threadId);
        } catch (error) {
          deps.warn(`PR summary write for thread ${threadId} failed: ${errorText(error)}`);
        }
      }),
    );
  }

  async function removeSummaries(threadIds: Iterable<string>) {
    await Promise.all(
      [...threadIds].map(async (threadId) => {
        if (removedSummaries.has(threadId)) return;
        try {
          await deps.removeSummary(threadId);
          removedSummaries.add(threadId);
          writtenSummaries.delete(threadId);
        } catch (error) {
          deps.warn(`PR summary removal for thread ${threadId} failed: ${errorText(error)}`);
        }
      }),
    );
  }

  async function storeReading(key: string, entry: CacheEntry) {
    if (entry.good === null || entry.error !== null) return;
    const { insight, pullRequestId, refreshedAt } = entry.good;
    try {
      await deps.kv.set(storedReadingKey(key), {
        v: 1,
        refreshedAt,
        reading: { insight, pullRequestId },
      } satisfies z.infer<typeof storedReadingSchema>);
    } catch (error) {
      deps.warn(`Storing PR insight for ${key} failed: ${errorText(error)}`);
    }
  }

  async function readStoredReading(
    key: string,
    threadIds: Set<string>,
  ): Promise<CacheEntry | null> {
    try {
      const stored = storedReadingSchema.safeParse(await deps.kv.get(storedReadingKey(key)));
      if (!stored.success) return null;
      const { reading, refreshedAt } = stored.data;
      return {
        good: { ...reading, refreshedAt },
        error: null,
        summaryError: null,
        threadIds,
        fromStorage: true,
      };
    } catch (error) {
      deps.warn(`Reading stored PR insight for ${key} failed: ${errorText(error)}`);
      return null;
    }
  }

  async function pruneStoredReadings(groups: readonly PrGroup[]) {
    const linked = new Set(groups.map((group) => storedReadingKey(prKey(group.target.ref))));
    try {
      const stale = (await deps.kv.list(STORED_READING_PREFIX)).filter((key) => !linked.has(key));
      await Promise.all(stale.map((key) => deps.kv.delete(key)));
    } catch (error) {
      deps.warn(`Pruning stored PR insight failed: ${errorText(error)}`);
    }
  }

  function syncSummaries(entry: CacheEntry): Promise<void> {
    if (entry.good === null) return removeSummaries(entry.threadIds);
    const summary = buildSummary({ ...entry.good, error: entry.summaryError });
    return writeSummaries(summary, entry.threadIds);
  }

  async function runRefresh(key: string, group: PrGroup): Promise<CacheEntry> {
    const previous = entries.get(key);
    let next: CacheEntry;
    try {
      const reading = await deps.fetchInsight(group.target);
      next = {
        good: { ...reading, refreshedAt: Date.now() },
        error: null,
        summaryError: null,
        threadIds: group.threadIds,
      };
    } catch (error) {
      pauseAfter(error);
      const message = errorText(error);
      deps.warn(`PR insight for ${key} failed: ${message}`);
      const failure = { summaryError: summaryErrorText(error), threadIds: group.threadIds };
      next = previous?.good
        ? { good: previous.good, error: message, ...failure }
        : { good: null, error: message, ...failure };
    }
    entries.set(key, next);
    if (previous?.fromStorage === true || !sameData(previous, next)) {
      deps.publish({ threadIds: [...next.threadIds], prKeys: [key] });
      await storeReading(key, next);
    }
    await syncSummaries(next);
    return next;
  }

  function refreshPr(group: PrGroup): Promise<CacheEntry> {
    const key = prKey(group.target.ref);
    const current = running.get(key);
    if (current !== undefined) {
      for (const threadId of group.threadIds) current.group.threadIds.add(threadId);
      return current.done;
    }
    const done = runRefresh(key, group).finally(() => running.delete(key));
    running.set(key, { group, done });
    return done;
  }

  function isSettled(target: PrTarget): boolean {
    const state = entries.get(prKey(target.ref))?.good?.insight.pr.state;
    return !target.openOnBb && (state === "merged" || state === "closed");
  }

  async function groupThreadsByPr(): Promise<ThreadsByPr> {
    const threadsByEnvironment = new Map<string, string[]>();
    const threadIdsWithoutPr: string[] = [];
    for (const thread of await deps.listThreads()) {
      if (thread.environmentId === null) {
        threadIdsWithoutPr.push(thread.id);
        continue;
      }
      const threads = threadsByEnvironment.get(thread.environmentId) ?? [];
      threads.push(thread.id);
      threadsByEnvironment.set(thread.environmentId, threads);
    }
    const groups = new Map<string, PrGroup>();
    let everyPrResolved = true;
    await Promise.all(
      [...threadsByEnvironment].map(async ([environmentId, threadIds]) => {
        const resolution = await deps.resolveEnvironmentPr(environmentId);
        if (resolution.kind === "no_pr") threadIdsWithoutPr.push(...threadIds);
        if (resolution.kind === "error") {
          everyPrResolved = false;
          deps.warn(`PR lookup for environment ${environmentId} failed: ${resolution.message}`);
        }
        if (resolution.kind !== "pr") return;
        const key = prKey(resolution.target.ref);
        const group = groups.get(key) ?? { target: resolution.target, threadIds: new Set() };
        for (const threadId of threadIds) group.threadIds.add(threadId);
        groups.set(key, group);
      }),
    );
    return { groups: [...groups.values()], threadIdsWithoutPr, everyPrResolved };
  }

  async function poll(): Promise<void> {
    if (isPaused()) return;
    const { groups, threadIdsWithoutPr, everyPrResolved } = await groupThreadsByPr();
    const due = groups.filter((group) => !isSettled(group.target));
    await Promise.all([
      removeSummaries(threadIdsWithoutPr),
      everyPrResolved ? pruneStoredReadings(groups) : undefined,
      forEachLimited(due, MAX_PARALLEL_REFRESHES, async (group) => {
        if (!isPaused()) await refreshPr(group);
      }),
    ]);
  }

  async function refreshThread(threadId: string, target: PrTarget): Promise<CacheEntry> {
    const threadIds = new Set(entries.get(prKey(target.ref))?.threadIds);
    threadIds.add(threadId);
    return refreshPr({ target, threadIds });
  }

  function refreshLinkedThreads(target: PrTarget): Promise<CacheEntry> {
    return refreshPr({ target, threadIds: new Set(entries.get(prKey(target.ref))?.threadIds) });
  }

  async function primaryTarget(ref: PullRequestRef): Promise<PrTarget | null> {
    const hostId = await deps.primaryHostId();
    return hostId === null ? null : { ref, hostId, openOnBb: false };
  }

  function isStale(entry: CacheEntry): boolean {
    return (
      entry.good === null ||
      entry.fromStorage === true ||
      Date.now() - entry.good.refreshedAt >= POLL_INTERVAL_MS
    );
  }

  function resultWhilePaused(entry: CacheEntry): InsightResult {
    const result = toResult(entry);
    if (result.kind !== "ok" || result.error !== null || !isPaused()) return result;
    return { ...result, error: RATE_LIMITED_TEXT };
  }

  return {
    async getInsight(threadId: string): Promise<InsightResult> {
      const resolution = await deps.resolvePr(threadId);
      if (resolution.kind !== "pr") return resolution;
      const key = prKey(resolution.target.ref);
      const entry = entries.get(key);
      if (entry !== undefined) {
        entry.threadIds.add(threadId);
        return resultWhilePaused(entry);
      }
      const stored = await readStoredReading(key, new Set([threadId]));
      if (stored !== null) {
        const current = entries.get(key) ?? stored;
        entries.set(key, current);
        if (!isPaused()) void refreshThread(threadId, resolution.target);
        return resultWhilePaused(current);
      }
      if (isPaused()) return { kind: "error", message: RATE_LIMITED_TEXT };
      return toResult(await refreshThread(threadId, resolution.target));
    },

    async refresh(threadId: string): Promise<InsightResult> {
      const resolution = await deps.resolvePr(threadId, FRESH);
      if (resolution.kind !== "pr") return resolution;
      return toResult(await refreshThread(threadId, resolution.target));
    },

    async getPrInsight(ref: PullRequestRef): Promise<InsightResult> {
      const key = prKey(ref);
      const known = entries.get(key) ?? (await readStoredReading(key, new Set()));
      if (known !== null && !entries.has(key)) entries.set(key, known);
      const entry = entries.get(key) ?? null;
      if (entry !== null && !isStale(entry)) return resultWhilePaused(entry);
      const target = isPaused() ? null : await primaryTarget(ref);
      if (target === null) {
        if (entry !== null) return resultWhilePaused(entry);
        return { kind: "error", message: isPaused() ? RATE_LIMITED_TEXT : NO_PRIMARY_HOST_TEXT };
      }
      if (entry === null) return toResult(await refreshLinkedThreads(target));
      if (!isSettled(target)) void refreshLinkedThreads(target);
      return resultWhilePaused(entry);
    },

    async refreshPrInsight(ref: PullRequestRef): Promise<InsightResult> {
      const target = await primaryTarget(ref);
      if (target === null) return { kind: "error", message: NO_PRIMARY_HOST_TEXT };
      return toResult(await refreshLinkedThreads(target));
    },

    async cachedPr(threadId: string): Promise<CachedPr> {
      const resolution = await deps.resolvePr(threadId);
      if (resolution.kind !== "pr") return resolution;
      const entry = entries.get(prKey(resolution.target.ref));
      if (entry === undefined || entry.good === null) return { kind: "not_cached" };
      return {
        kind: "cached",
        target: resolution.target,
        insight: entry.good.insight,
        pullRequestId: entry.good.pullRequestId,
      };
    },

    async refreshAfterWrite(threadId: string): Promise<void> {
      const resolution = await deps.resolvePr(threadId, FRESH);
      if (resolution.kind !== "pr") return;
      await running.get(prKey(resolution.target.ref))?.done;
      await refreshThread(threadId, resolution.target);
    },

    async refreshOnIdle(threadId: string, signal: AbortSignal): Promise<void> {
      try {
        if (isPaused()) return;
        let resolution = await deps.resolvePr(threadId, FRESH);
        // BB can link a PR that the agent just opened a few seconds after the turn ends.
        if (resolution.kind === "no_pr") {
          await sleep(IDLE_RETRY_MS, signal);
          if (signal.aborted || isPaused()) return;
          resolution = await deps.resolvePr(threadId, FRESH);
        }
        if (resolution.kind === "error") throw new Error(resolution.message);
        if (resolution.kind !== "pr" || isSettled(resolution.target) || isPaused()) return;
        await refreshThread(threadId, resolution.target);
      } catch (error) {
        deps.warn(`PR refresh on idle for thread ${threadId} failed: ${errorText(error)}`);
      }
    },

    async run(signal: AbortSignal): Promise<void> {
      const aborted = new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      while (!signal.aborted) {
        // A GitHub call through a disconnected host can hang, and BB marks the
        // plugin degraded if the service does not return after abort.
        await Promise.race([
          poll().catch((error) => deps.warn(`PR poll failed: ${errorText(error)}`)),
          aborted,
        ]);
        if (signal.aborted) return;
        await sleep(Math.max(POLL_INTERVAL_MS, deps.pause.pausedUntil() - Date.now()), signal);
      }
    },
  };
}
