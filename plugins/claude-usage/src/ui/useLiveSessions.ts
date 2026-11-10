import { useCallback, useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../rpc";
import { usePolled } from "./usePolled";

/** The cache clock runs in minutes, so a quarter-minute poll keeps every countdown honest. */
export const LIVE_POLL_MS = 15_000;

export function useLiveSessions() {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("liveSessions"), [rpc]);
  return usePolled(load, LIVE_POLL_MS);
}

/** Re-renders on an interval, so idle times and countdowns move between polls. */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(tick);
  }, [intervalMs]);
  return now;
}
