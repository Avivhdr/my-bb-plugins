import type { Summaries } from "./contract";
import { summariesFingerprint } from "./summaries";

export const SUMMARIES_CHANGED_CHANNEL = "summaries.changed";
export const WATCH_INTERVAL_MS = 5_000;

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

export async function watchSummaries({
  read,
  onChange,
  signal,
}: {
  read: () => Promise<Summaries>;
  onChange: () => void;
  signal: AbortSignal;
}): Promise<void> {
  const aborted = new Promise<null>((resolve) =>
    signal.addEventListener("abort", () => resolve(null), { once: true }),
  );
  let last: string | null = null;
  while (!signal.aborted) {
    const summaries = await Promise.race([read().catch(() => null), aborted]);
    if (signal.aborted) return;
    if (summaries !== null) {
      const next = summariesFingerprint(summaries);
      if (last !== null && next !== last) onChange();
      last = next;
    }
    await sleep(WATCH_INTERVAL_MS, signal);
  }
}
