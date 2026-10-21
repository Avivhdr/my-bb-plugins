import { afterEach, describe, expect, it, vi } from "vitest";
import { createRateLimitPause, RATE_LIMIT_FALLBACK_MS } from "./rate-limit-pause";

describe("createRateLimitPause", () => {
  afterEach(() => vi.useRealTimers());

  it("is paused until the reset time", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000 });
    const pause = createRateLimitPause();
    expect(pause.isPaused()).toBe(false);

    pause.pauseUntilReset(5_000);
    expect(pause.isPaused()).toBe(true);
    expect(pause.pausedUntil()).toBe(5_000);

    vi.setSystemTime(5_000);
    expect(pause.isPaused()).toBe(false);
  });

  it("pauses for the fallback time without a reset time", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000 });
    const pause = createRateLimitPause();
    pause.pauseUntilReset(null);
    expect(pause.pausedUntil()).toBe(1_000 + RATE_LIMIT_FALLBACK_MS);
  });

  it("keeps a later pause when an earlier one arrives", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: 1_000 });
    const pause = createRateLimitPause();
    pause.pauseUntilReset(9_000);
    pause.pauseUntilReset(4_000);
    expect(pause.pausedUntil()).toBe(9_000);
  });
});
