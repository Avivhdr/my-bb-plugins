import { useCallback } from "react";
import { useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { formatMoney } from "../format";
import type { rpcContract } from "../rpc";
import { usePolled } from "./usePolled";

export function ThreadSpend({ threadId, isCompactViewport }: PluginThreadHeaderActionProps) {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("threadSpend", { threadId }), [rpc, threadId]);
  const { value: spend } = usePolled(load);
  if (!spend || spend.threadId !== threadId) return null;
  if (!spend.found) {
    return (
      <span
        className="px-2 text-xs text-muted-foreground"
        title="No Claude Code spend is recorded for this thread. Threads that share a directory count for their project only."
      >
        {isCompactViewport ? "–" : "No spend recorded"}
      </span>
    );
  }
  return (
    <span className="px-2 text-xs tabular-nums text-muted-foreground" title="Claude Code spend in this thread">
      {formatMoney(spend.total)}
    </span>
  );
}
