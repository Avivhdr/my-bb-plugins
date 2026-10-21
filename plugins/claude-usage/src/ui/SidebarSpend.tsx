import { useCallback } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { formatMoney } from "../format";
import type { rpcContract } from "../rpc";
import { usePolled } from "./usePolled";

export function SidebarSpend() {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("dashboard"), [rpc]);
  const { value: dashboard } = usePolled(load);
  if (!dashboard || dashboard.indexing) return null;
  return (
    <span className="text-xs tabular-nums text-muted-foreground" title="Claude Code spend today">
      {formatMoney(dashboard.totals.today.total)}
    </span>
  );
}
