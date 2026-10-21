export const RATE_LIMIT_FALLBACK_MS = 5 * 60_000;

export type RateLimitPause = ReturnType<typeof createRateLimitPause>;

export function createRateLimitPause() {
  let until = 0;
  return {
    isPaused: () => Date.now() < until,
    pausedUntil: () => until,
    pauseUntilReset(resetAt: number | null) {
      until = Math.max(until, resetAt ?? Date.now() + RATE_LIMIT_FALLBACK_MS);
    },
  };
}
