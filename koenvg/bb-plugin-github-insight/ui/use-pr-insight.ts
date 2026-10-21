import { useCallback, useState } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { InsightResult, rpcContract } from "../contract";
import { INSIGHT_UPDATED_CHANNEL, mentionsPr } from "../core/insight-updated";
import { prKey, type PullRequestRef } from "../core/pr-ref";
import { useThreadResult, type LoadMode } from "./use-thread-result";

type OkInsightResult = Extract<InsightResult, { kind: "ok" }>;

export function usePrInsight({ owner, repo, number }: PullRequestRef) {
  const rpc = useRpc<typeof rpcContract>();
  const key = prKey({ owner, repo, number });
  const fetchInsight = useCallback(
    (_key: string, mode: LoadMode) =>
      rpc.call(mode === "refresh" ? "refreshPrInsight" : "getPrInsight", { owner, repo, number }),
    [rpc, owner, repo, number],
  );
  const state = useThreadResult(key, fetchInsight);
  const [lastGood, setLastGood] = useState<{ key: string; result: OkInsightResult } | null>(null);
  const loaded = state.result;
  if (loaded?.kind === "ok" && (lastGood?.key !== key || lastGood.result !== loaded)) {
    setLastGood({ key, result: loaded });
  }
  const previous = lastGood?.key === key ? lastGood.result : null;
  const result: InsightResult | null =
    loaded?.kind === "error" && previous !== null ? { ...previous, error: loaded.message } : loaded;

  useRealtime(INSIGHT_UPDATED_CHANNEL, (payload) => {
    if (mentionsPr(payload, key)) state.reload();
  });

  return { ...state, result };
}
