import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { ReviewQueueResult, ReviewQueueView, rpcContract } from "../contract";
import { readReviewQueueUpdate, REVIEW_QUEUE_UPDATED_CHANNEL } from "../core/review-queue-updated";
import { messageOf } from "./error-message";

export interface ReviewQueueState {
  view: ReviewQueueView | null;
  error: string | null;
  refreshing: boolean;
  refresh: () => void;
}

export function useReviewQueue(): ReviewQueueState {
  const rpc = useRpc<typeof rpcContract>();
  const [view, setView] = useState<ReviewQueueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const latestResult = useRef(0);

  const apply = useCallback((result: ReviewQueueResult) => {
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
    async (call: () => Promise<ReviewQueueResult>) => {
      const request = ++latestResult.current;
      const isLatest = () => request === latestResult.current;
      try {
        const result = await call();
        if (isLatest()) apply(result);
      } catch (failure) {
        if (isLatest()) setError(messageOf(failure));
      }
    },
    [apply],
  );

  useEffect(() => {
    void track(() => rpc.call("getReviewQueue", {}));
    return () => {
      latestResult.current++;
    };
  }, [rpc, track]);

  useRealtime(REVIEW_QUEUE_UPDATED_CHANNEL, (payload) => {
    const update = readReviewQueueUpdate(payload);
    if (update === null) return;
    latestResult.current++;
    apply(update);
  });

  const refresh = useCallback(() => {
    setRefreshing(true);
    void track(() => rpc.call("refreshReviewQueue", {})).finally(() => setRefreshing(false));
  }, [rpc, track]);

  return { view, error, refreshing, refresh };
}
