import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { parsePullRequestUrl, type PullRequestRef } from "./core/pr-ref";
import { isRateLimitMessage, RATE_LIMITED_TEXT } from "./github/gh-failure";
import type { RateLimitPause } from "./github/rate-limit-pause";
import type { UpstreamPr } from "./contract";

const PR_STATUS_PLUGIN_ID = "bb--github-pr-status";

const linkedPullRequestsSchema = z.record(
  z.string(),
  z.discriminatedUnion("outcome", [
    z.object({
      outcome: z.literal("available"),
      pullRequest: z.object({
        url: z.string(),
        state: z.enum(["open", "draft", "closed", "merged"]),
      }),
    }),
    z.object({ outcome: z.literal("absent") }),
    z.object({
      outcome: z.literal("unavailable"),
      message: z.string(),
    }),
  ]),
);

type LinkedPullRequestRow = z.infer<typeof linkedPullRequestsSchema>[string];

export interface PrTarget {
  ref: PullRequestRef;
  hostId: string;
  openOnBb: boolean;
}

export type PrResolution =
  | { kind: "no_pr" }
  | { kind: "error"; message: string }
  | { kind: "pr"; target: PrTarget };

export interface LookupOptions {
  fresh?: boolean;
  recheckNoPr?: boolean;
}

export const RECHECK_NO_PR: LookupOptions = { recheckNoPr: true };

type LinkedPrState = "open" | "draft" | "closed" | "merged";

const MINUTE = 60_000;
export const LOOKUP_SHARE_MS = 30_000;
const NO_PR_TTL_MS = 5 * MINUTE;
const PR_TTL_MS: Record<LinkedPrState, number> = {
  open: MINUTE,
  draft: MINUTE,
  closed: 15 * MINUTE,
  merged: 60 * MINUTE,
};

const RATE_LIMITED: PrResolution = { kind: "error", message: RATE_LIMITED_TEXT };

interface StoredLookup {
  resolution: PrResolution;
  expiresAt: number;
}

export interface PrLookupDeps {
  sdk: Pick<BbPluginApi["sdk"], "threads" | "environments" | "plugins">;
  pause: RateLimitPause;
  readRateLimitReset(hostId: string): Promise<number | null>;
  /** Looks for a PR on the branch's upstream name when it differs from the local name. */
  findUpstreamPr(hostId: string, path: string): Promise<UpstreamPr>;
}

export function createPrLookup({ sdk, pause, readRateLimitReset, findUpstreamPr }: PrLookupDeps) {
  const stored = new Map<string, StoredLookup>();
  const running = new Map<string, { done: Promise<PrResolution>; released: Promise<void> }>();

  function store(environmentId: string, resolution: PrResolution, ttlMs: number): PrResolution {
    stored.set(environmentId, { resolution, expiresAt: Date.now() + ttlMs });
    return resolution;
  }

  async function pauseForRateLimit(hostId: string): Promise<void> {
    const resetAt = await readRateLimitReset(hostId).catch(() => null);
    pause.pauseUntilReset(resetAt);
  }

  function storePr(
    environmentId: string,
    hostId: string,
    { url, state }: { url: string; state: LinkedPrState },
  ): PrResolution {
    const ref = parsePullRequestUrl(url);
    if (ref === null) {
      stored.delete(environmentId);
      return { kind: "error", message: `Not a github.com pull request: ${url}` };
    }
    const target = { ref, hostId, openOnBb: state === "open" || state === "draft" };
    return store(environmentId, { kind: "pr", target }, PR_TTL_MS[state]);
  }

  // bb looks the PR up by the local branch name, so a branch pushed under another name has none.
  async function lookUpUpstream(
    environmentId: string,
    { hostId, path }: { hostId: string; path?: string | null },
  ): Promise<PrResolution> {
    if (path) {
      const upstream = await findUpstreamPr(hostId, path).catch(() => null);
      if (upstream?.kind === "pr") return storePr(environmentId, hostId, upstream);
    }
    return store(environmentId, { kind: "no_pr" }, NO_PR_TTL_MS);
  }

  async function lookUp(environmentId: string): Promise<PrResolution> {
    let linked: LinkedPullRequestRow;
    let environment: Awaited<ReturnType<typeof sdk.environments.get>>;
    try {
      const [rows, got] = await Promise.all([
        sdk.plugins.callRpc({
          pluginId: PR_STATUS_PLUGIN_ID,
          method: "pullRequests",
          input: { keys: [environmentId] },
          outputSchema: linkedPullRequestsSchema,
        }),
        sdk.environments.get({ environmentId }),
      ]);
      environment = got;
      const row = rows[environmentId];
      if (row === undefined) {
        stored.delete(environmentId);
        return {
          kind: "error",
          message: "GitHub PR Status returned no row for this environment",
        };
      }
      linked = row;
    } catch (error) {
      stored.delete(environmentId);
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (linked.outcome === "absent") return lookUpUpstream(environmentId, environment);
    if (linked.outcome === "unavailable") {
      if (linked.message.includes("no git remotes found")) {
        return store(environmentId, { kind: "no_pr" }, NO_PR_TTL_MS);
      }
      if (isRateLimitMessage(linked.message)) {
        await pauseForRateLimit(environment.hostId);
        const known = stored.get(environmentId)?.resolution;
        return known?.kind === "pr" ? known : RATE_LIMITED;
      }
      stored.delete(environmentId);
      return { kind: "error", message: linked.message };
    }
    return storePr(environmentId, environment.hostId, linked.pullRequest);
  }

  // A lookup through a disconnected host can hang. Later callers stop waiting on it after a while.
  function lookUpOnce(environmentId: string): Promise<PrResolution> {
    const current = running.get(environmentId);
    if (current !== undefined) return current.done;
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const forget = () => {
      clearTimeout(timer);
      if (running.get(environmentId)?.done === done) running.delete(environmentId);
      release();
    };
    const timer = setTimeout(forget, LOOKUP_SHARE_MS);
    const done = lookUp(environmentId).finally(forget);
    running.set(environmentId, { done, released });
    return done;
  }

  async function lookUpAfterRunning(environmentId: string): Promise<PrResolution> {
    await running.get(environmentId)?.released;
    return lookUpOnce(environmentId);
  }

  async function resolveEnvironmentPr(
    environmentId: string,
    { fresh = false, recheckNoPr = false }: LookupOptions = {},
  ): Promise<PrResolution> {
    if (!fresh) {
      const known = stored.get(environmentId);
      if (pause.isPaused()) return known?.resolution ?? RATE_LIMITED;
      const reusable =
        known !== undefined &&
        Date.now() < known.expiresAt &&
        !(recheckNoPr && known.resolution.kind === "no_pr");
      if (reusable) return known.resolution;
      return lookUpOnce(environmentId);
    }
    return lookUpAfterRunning(environmentId);
  }

  async function resolvePr(threadId: string, options?: LookupOptions): Promise<PrResolution> {
    const { environmentId } = await sdk.threads.get({ threadId });
    if (environmentId === null) return { kind: "no_pr" };
    return resolveEnvironmentPr(environmentId, options);
  }

  return { resolvePr, resolveEnvironmentPr };
}
