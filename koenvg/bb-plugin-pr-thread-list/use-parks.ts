import { useCallback, useMemo } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { PARKS_CHANGED_CHANNEL, parksSchema } from "./contract-schemas";
import { useLiveRpc } from "./live-rpc";

export interface ParkControls {
  /** Threads moved to Later directly; descendants inherit this in the list model. */
  explicit: ReadonlySet<string>;
  ready: boolean;
  park: (threadId: string) => Promise<unknown>;
  unpark: (threadId: string) => Promise<unknown>;
}

const NONE: ReadonlySet<string> = new Set();

export function useParks(): ParkControls {
  const rpc = useRpc<typeof rpcContract>();
  const read = useCallback(async () => parksSchema.parse(await rpc.call("listParks", {})), [rpc]);
  const [result, reload, status] = useLiveRpc(PARKS_CHANGED_CHANNEL, read);
  const explicit = useMemo(() => (result ? new Set(result.threadIds) : NONE), [result]);
  const park = useCallback(
    (threadId: string) => rpc.call("park", { threadId }).then(reload),
    [rpc, reload],
  );
  const unpark = useCallback(
    (threadId: string) => rpc.call("unpark", { threadId }).then(reload),
    [rpc, reload],
  );
  return useMemo(
    () => ({ explicit, ready: status === "ready", park, unpark }),
    [explicit, status, park, unpark],
  );
}
