import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { ChangesResult, DiffTarget } from "../core/changes";
import { messageOf } from "../core/changes";

export interface ChangesState {
  result: ChangesResult | null;
  loading: boolean;
  generation: number;
  refresh: () => void;
}

export function useChanges(threadId: string, target: DiffTarget): ChangesState {
  const rpc = useRpc<typeof rpcContract>();
  const [result, setResult] = useState<ChangesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const latestRequest = useRef(0);
  const [generation, setGeneration] = useState(0);

  const load = useCallback(async () => {
    const request = ++latestRequest.current;
    setGeneration(request);
    setLoading(true);
    const next = await rpc
      .call("getChanges", { threadId, target })
      .catch((error: unknown): ChangesResult => ({ kind: "error", message: messageOf(error) }));
    if (request !== latestRequest.current) return;
    setResult(next);
    setLoading(false);
  }, [rpc, threadId, target]);

  useEffect(() => {
    void load();
    return () => {
      latestRequest.current++;
    };
  }, [load]);

  return { result, loading, generation, refresh: () => void load() };
}
