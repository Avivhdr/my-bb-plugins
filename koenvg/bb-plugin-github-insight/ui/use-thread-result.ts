import { useCallback, useEffect, useRef, useState } from "react";

export type LoadMode = "load" | "refresh";

interface ErrorResult {
  kind: "error";
  message: string;
}

export interface ThreadResultState<R> {
  result: R | ErrorResult | null;
  refreshing: boolean;
  generation: number;
  revalidating: boolean;
  reload: () => void;
  refresh: () => Promise<R | ErrorResult | null>;
  patch: (change: (result: R | ErrorResult) => R | ErrorResult) => void;
}

export function useThreadResult<R>(
  threadId: string,
  fetch: (threadId: string, mode: LoadMode) => Promise<R>,
  snapshot?: (threadId: string) => R | null,
): ThreadResultState<R> {
  const [loaded, setLoaded] = useState<{
    threadId: string;
    result: R | ErrorResult;
  } | null>(null);
  const [refreshingThreadId, setRefreshingThreadId] = useState<string | null>(null);
  const [loadingThreadId, setLoadingThreadId] = useState<string | null>(null);
  const latestRequest = useRef(0);
  const refreshOwner = useRef<{ threadId: string; reloadRequested: boolean } | null>(null);

  const load = useCallback(
    async (mode: LoadMode) => {
      const request = ++latestRequest.current;
      if (mode === "load") setLoadingThreadId(threadId);
      const result = await fetch(threadId, mode).catch((error: unknown): ErrorResult => ({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      }));
      if (request !== latestRequest.current) return null;
      setLoaded({ threadId, result });
      setLoadingThreadId((current) => (current === threadId ? null : current));
      return result;
    },
    [fetch, threadId],
  );

  useEffect(() => {
    setRefreshingThreadId(null);
    void load("load");
    return () => {
      latestRequest.current++;
      refreshOwner.current = null;
    };
  }, [load]);

  const reload = useCallback(() => {
    const owner = refreshOwner.current;
    if (owner?.threadId === threadId) owner.reloadRequested = true;
    else void load("load");
  }, [load, threadId]);

  const refresh = useCallback(async () => {
    const owner = { threadId, reloadRequested: false };
    refreshOwner.current = owner;
    setRefreshingThreadId(threadId);
    try {
      let result = await load("refresh");
      // The server publishes changes before replying. Reconcile those signals
      // after the response instead of letting them cancel their own refresh.
      while (result !== null && refreshOwner.current === owner && owner.reloadRequested) {
        owner.reloadRequested = false;
        result = await load("load");
      }
      return refreshOwner.current === owner ? result : null;
    } finally {
      if (refreshOwner.current === owner) {
        refreshOwner.current = null;
        setRefreshingThreadId((current) => (current === threadId ? null : current));
      }
    }
  }, [load, threadId]);

  const patch = useCallback(
    (change: (result: R | ErrorResult) => R | ErrorResult) =>
      setLoaded((current) =>
        current?.threadId === threadId ? { threadId, result: change(current.result) } : current,
      ),
    [threadId],
  );

  const result = loaded?.threadId === threadId ? loaded.result : (snapshot?.(threadId) ?? null);
  return {
    result,
    generation: latestRequest.current,
    refreshing: refreshingThreadId === threadId,
    revalidating: loadingThreadId === threadId && result !== null,
    reload,
    refresh,
    patch,
  };
}
