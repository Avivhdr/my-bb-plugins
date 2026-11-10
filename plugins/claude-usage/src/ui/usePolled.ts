import { useCallback, useEffect, useState } from "react";

export const POLL_MS = 60_000;

/** The backend rescans on its own interval, so an open view re-reads or it shows what was true at mount. */
export function usePolled<T>(load: () => Promise<T>, intervalMs = POLL_MS) {
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setValue(await load());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [load]);
  useEffect(() => {
    void refresh();
    const poll = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(poll);
  }, [refresh, intervalMs]);
  return { value, error, refresh };
}
