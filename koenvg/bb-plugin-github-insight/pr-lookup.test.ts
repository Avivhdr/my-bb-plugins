import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrLookup, LOOKUP_SHARE_MS } from "./pr-lookup";
import { createRateLimitPause, RATE_LIMIT_FALLBACK_MS } from "./github/rate-limit-pause";
import { linkedPr, type PullRequestResult } from "./test/plugin-harness";

const MINUTE = 60_000;
const RATE_LIMIT_MESSAGE = "gh pr view failed: GraphQL: API rate limit already exceeded";

function setup(initial: PullRequestResult = linkedPr(7)) {
  let answer: () => Promise<PullRequestResult> = async () => initial;
  const pullRequest = vi.fn((_request: { environmentId: string }) => answer());
  const readRateLimitReset = vi.fn(async (_hostId: string): Promise<number | null> => null);
  const get = vi.fn(async (_request: { environmentId: string }) => ({ hostId: "host-1" }));
  const pause = createRateLimitPause();
  const lookup = createPrLookup({
    sdk: {
      threads: { get: async () => ({ environmentId: "env_1" }) },
      environments: { pullRequest, get },
    } as unknown as Parameters<typeof createPrLookup>[0]["sdk"],
    pause,
    readRateLimitReset,
  });
  return {
    ...lookup,
    pause,
    pullRequest,
    get,
    readRateLimitReset,
    answer(next: PullRequestResult | (() => Promise<PullRequestResult>)) {
      answer = typeof next === "function" ? next : async () => next;
    },
  };
}

const unavailable = (message: string): PullRequestResult => ({ outcome: "unavailable", message });

describe("createPrLookup", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00Z") });
  });
  afterEach(() => vi.useRealTimers());

  it("returns the PR target of the environment", async () => {
    const lookup = setup();
    expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
      kind: "pr",
      target: {
        ref: { owner: "collibra", repo: "frontend", number: 7 },
        hostId: "host-1",
        openOnBb: true,
      },
    });
  });

  it.each([
    ["an open PR", 1, linkedPr(7, "open")],
    ["a draft PR", 1, linkedPr(7, "draft")],
    ["no PR", 5, { outcome: "absent" } as const],
    ["a closed PR", 15, linkedPr(7, "closed")],
    ["a merged PR", 60, linkedPr(7, "merged")],
  ])("reuses %s for %i minutes", async (_name, minutes, result) => {
    const lookup = setup(result);
    await lookup.resolveEnvironmentPr("env_1");

    vi.advanceTimersByTime(minutes * MINUTE - 1);
    await lookup.resolveEnvironmentPr("env_1");
    expect(lookup.pullRequest).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    await lookup.resolveEnvironmentPr("env_1");
    expect(lookup.pullRequest).toHaveBeenCalledTimes(2);
  });

  it("reuses a lookup without git remotes as no PR", async () => {
    const lookup = setup(unavailable("gh pr view failed: no git remotes found"));
    expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({ kind: "no_pr" });
    expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({ kind: "no_pr" });
    expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
  });

  it("looks up again when asked to recheck a stored no PR", async () => {
    const lookup = setup({ outcome: "absent" });
    await lookup.resolveEnvironmentPr("env_1");
    lookup.answer(linkedPr(15));

    expect((await lookup.resolveEnvironmentPr("env_1", { recheckNoPr: true })).kind).toBe("pr");
  });

  it("reuses a stored PR when asked to recheck no PR", async () => {
    const lookup = setup();
    await lookup.resolveEnvironmentPr("env_1");

    await lookup.resolveEnvironmentPr("env_1", { recheckNoPr: true });

    expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
  });

  it("does not reuse a failed lookup", async () => {
    const lookup = setup(unavailable("gh not logged in"));
    expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
      kind: "error",
      message: "gh not logged in",
    });
    await lookup.resolveEnvironmentPr("env_1");
    expect(lookup.pullRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["pullRequest", "get"] as const)(
    "returns an error for rejected environments.%s reads and retries without reusing stale results",
    async (method) => {
      const lookup = setup(linkedPr(7, "merged"));
      lookup[method].mockRejectedValueOnce(new Error("HTTP 409: Environment unavailable"));

      expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
        kind: "error",
        message: "HTTP 409: Environment unavailable",
      });
      expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
        kind: "pr",
        target: {
          ref: { owner: "collibra", repo: "frontend", number: 7 },
          hostId: "host-1",
          openOnBb: false,
        },
      });

      lookup[method].mockRejectedValueOnce(new Error("HTTP 409: Environment unavailable"));
      expect(await lookup.resolveEnvironmentPr("env_1", { fresh: true })).toEqual({
        kind: "error",
        message: "HTTP 409: Environment unavailable",
      });
      lookup.answer(linkedPr(15));
      expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
        kind: "pr",
        target: {
          ref: { owner: "collibra", repo: "frontend", number: 15 },
          hostId: "host-1",
          openOnBb: true,
        },
      });
    },
  );

  it("forgets the stored result when a later lookup fails", async () => {
    const lookup = setup(linkedPr(7, "merged"));
    await lookup.resolveEnvironmentPr("env_1");
    lookup.answer(unavailable("gh not logged in"));
    await lookup.resolveEnvironmentPr("env_1", { fresh: true });

    await lookup.resolveEnvironmentPr("env_1");

    expect(lookup.pullRequest).toHaveBeenCalledTimes(3);
  });

  it("does not let a lookup that never answers block later lookups", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const lookup = setup();
    lookup.answer(() => new Promise(() => {}));
    void lookup.resolveEnvironmentPr("env_1");
    lookup.answer(linkedPr(7));

    await vi.advanceTimersByTimeAsync(LOOKUP_SHARE_MS);

    expect((await lookup.resolveEnvironmentPr("env_1")).kind).toBe("pr");
    expect(lookup.pullRequest).toHaveBeenCalledTimes(2);
  });

  it("does not let a lookup that never answers block a fresh lookup", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    const lookup = setup();
    lookup.answer(() => new Promise(() => {}));
    void lookup.resolveEnvironmentPr("env_1");
    lookup.answer(linkedPr(7));

    const fresh = lookup.resolveEnvironmentPr("env_1", { fresh: true });
    await vi.advanceTimersByTimeAsync(LOOKUP_SHARE_MS);

    expect((await fresh).kind).toBe("pr");
  });

  it("keeps lookups of different environments apart", async () => {
    const lookup = setup();
    await lookup.resolveEnvironmentPr("env_1");
    await lookup.resolveEnvironmentPr("env_2");
    expect(lookup.pullRequest).toHaveBeenCalledTimes(2);
  });

  it("resolves a thread through its environment's stored lookup", async () => {
    const lookup = setup();
    await lookup.resolveEnvironmentPr("env_1");
    expect((await lookup.resolvePr("thr_1")).kind).toBe("pr");
    expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
  });

  it("shares one bb call between concurrent lookups of an environment", async () => {
    const lookup = setup();
    const [first, second] = await Promise.all([
      lookup.resolveEnvironmentPr("env_1"),
      lookup.resolveEnvironmentPr("env_1"),
    ]);
    expect(first).toEqual(second);
    expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
  });

  describe("fresh lookups", () => {
    it("ask bb even when a valid result is stored, and replace it", async () => {
      const lookup = setup({ outcome: "absent" });
      await lookup.resolveEnvironmentPr("env_1");
      lookup.answer(linkedPr(8));

      const fresh = await lookup.resolvePr("thr_1", { fresh: true });
      expect(fresh.kind === "pr" && fresh.target.ref.number).toBe(8);
      const reused = await lookup.resolveEnvironmentPr("env_1");
      expect(reused.kind === "pr" && reused.target.ref.number).toBe(8);
      expect(lookup.pullRequest).toHaveBeenCalledTimes(2);
    });

    it("see bb's answer from after a lookup that was already running", async () => {
      const lookup = setup({ outcome: "absent" });
      const running = lookup.resolveEnvironmentPr("env_1");
      lookup.answer(linkedPr(8));

      const fresh = await lookup.resolveEnvironmentPr("env_1", { fresh: true });

      expect(await running).toEqual({ kind: "no_pr" });
      expect(fresh.kind === "pr" && fresh.target.ref.number).toBe(8);
    });

    it("share one bb call when they arrive together", async () => {
      const lookup = setup();
      await Promise.all([
        lookup.resolveEnvironmentPr("env_1", { fresh: true }),
        lookup.resolveEnvironmentPr("env_1", { fresh: true }),
      ]);
      expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe("rate limits", () => {
    it("pause until the GraphQL reset time of the environment's host", async () => {
      const lookup = setup(unavailable(RATE_LIMIT_MESSAGE));
      const resetAt = Date.now() + 12 * MINUTE;
      lookup.readRateLimitReset.mockResolvedValue(resetAt);

      await lookup.resolveEnvironmentPr("env_1");

      expect(lookup.readRateLimitReset).toHaveBeenCalledWith("host-1");
      expect(lookup.pause.pausedUntil()).toBe(resetAt);
    });

    it("pause for the fallback time when the reset time is unknown", async () => {
      const lookup = setup(unavailable(RATE_LIMIT_MESSAGE));
      lookup.readRateLimitReset.mockRejectedValue(new Error("host disconnected"));

      await lookup.resolveEnvironmentPr("env_1");

      expect(lookup.pause.pausedUntil()).toBe(Date.now() + RATE_LIMIT_FALLBACK_MS);
    });

    it("return the last known result when the lookup is rate limited", async () => {
      const lookup = setup();
      const known = await lookup.resolveEnvironmentPr("env_1");
      lookup.answer(unavailable(RATE_LIMIT_MESSAGE));

      expect(await lookup.resolveEnvironmentPr("env_1", { fresh: true })).toEqual(known);
    });

    it("fail with rate limited when the last known result is no PR", async () => {
      const lookup = setup({ outcome: "absent" });
      await lookup.resolveEnvironmentPr("env_1");
      lookup.answer(unavailable(RATE_LIMIT_MESSAGE));

      expect(await lookup.resolveEnvironmentPr("env_1", { fresh: true })).toEqual({
        kind: "error",
        message: "rate limited",
      });
    });

    it("fail with rate limited when no result is known", async () => {
      const lookup = setup(unavailable(RATE_LIMIT_MESSAGE));
      expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
        kind: "error",
        message: "rate limited",
      });
    });
  });

  describe("while paused", () => {
    it("returns an expired result without asking bb", async () => {
      const lookup = setup();
      const known = await lookup.resolveEnvironmentPr("env_1");
      vi.advanceTimersByTime(2 * MINUTE);
      lookup.pause.pauseUntilReset(null);

      expect(await lookup.resolveEnvironmentPr("env_1")).toEqual(known);
      expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
    });

    it("fails with rate limited for an environment it never looked up", async () => {
      const lookup = setup();
      lookup.pause.pauseUntilReset(null);

      expect(await lookup.resolveEnvironmentPr("env_1")).toEqual({
        kind: "error",
        message: "rate limited",
      });
      expect(lookup.pullRequest).not.toHaveBeenCalled();
    });

    it("still asks bb for a fresh lookup", async () => {
      const lookup = setup();
      lookup.pause.pauseUntilReset(null);

      expect((await lookup.resolveEnvironmentPr("env_1", { fresh: true })).kind).toBe("pr");
      expect(lookup.pullRequest).toHaveBeenCalledTimes(1);
    });
  });
});
