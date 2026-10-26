import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { ActivityResult, ActivityView, rpcContract } from "../contract";
import { ACTIVITY_UPDATED_CHANNEL, readActivityUpdate } from "../core/activity-view";
import { messageOf } from "./error-message";

export interface ActivityState {
  view: ActivityView | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
}

/** The stored activity feed, kept current by `activity.updated`. */
export function useActivity(): ActivityState {
  const rpc = useRpc<typeof rpcContract>();
  const [view, setView] = useState<ActivityView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(0);

  const apply = useCallback((result: ActivityResult) => {
    if (result.kind === "loading") return;
    if (result.kind === "ok") {
      const { kind: _, ...loaded } = result;
      setView(loaded);
      setError(null);
    } else {
      if (result.lastGood !== null) setView(result.lastGood);
      setError(result.message);
    }
  }, []);

  const track = useCallback(
    async (call: () => Promise<ActivityResult>) => {
      const request = ++latest.current;
      try {
        const result = await call();
        if (request === latest.current) apply(result);
      } catch (failure) {
        if (request === latest.current) setError(messageOf(failure));
      }
    },
    [apply],
  );

  useEffect(() => {
    void track(() => rpc.call("getActivity", {}));
    return () => {
      latest.current++;
    };
  }, [rpc, track]);

  useRealtime(ACTIVITY_UPDATED_CHANNEL, (payload) => {
    const update = readActivityUpdate(payload);
    if (update === null) return;
    latest.current++;
    apply(update);
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    void track(() => rpc.call("refreshActivity", {})).finally(() => setRefreshing(false));
  }, [rpc, track]);

  return { view, error, refreshing, refresh };
}
