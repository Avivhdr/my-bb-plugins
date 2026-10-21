import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { parsePullRequestUrl, type PullRequestRef } from "./core/pr-ref";
import { isRateLimitMessage, RATE_LIMITED_TEXT } from "./github/gh-failure";
import type { RateLimitPause } from "./github/rate-limit-pause";

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
  sdk: Pick<BbPluginApi["sdk"], "threads" | "environments">;
  pause: RateLimitPause;
  readRateLimitReset(hostId: string): Promise<number | null>;
}

export function createPrLookup({ sdk, pause, readRateLimitReset }: PrLookupDeps) {
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

  async function lookUp(environmentId: string): Promise<PrResolution> {
    let linked: Awaited<ReturnType<typeof sdk.environments.pullRequest>>;
    let environment: Awaited<ReturnType<typeof sdk.environments.get>>;
    try {
      [linked, environment] = await Promise.all([
        sdk.environments.pullRequest({ environmentId }),
        sdk.environments.get({ environmentId }),
      ]);
    } catch (error) {
      stored.delete(environmentId);
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
    if (linked.outcome === "absent") return store(environmentId, { kind: "no_pr" }, NO_PR_TTL_MS);
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
    const { url, state } = linked.pullRequest;
    const ref = parsePullRequestUrl(url);
    if (ref === null) {
      stored.delete(environmentId);
      return { kind: "error", message: `Not a github.com pull request: ${url}` };
    }
    const target = {
      ref,
      hostId: environment.hostId,
      openOnBb: state === "open" || state === "draft",
    };
    return store(environmentId, { kind: "pr", target }, PR_TTL_MS[state]);
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
