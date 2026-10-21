import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtime, useRealtimeConnectionState } from "@get-bb/plugin-sdk/app";

export type RpcLoadStatus = "loading" | "ready" | "error";

/** `read` and `subscribe` must keep their identity, or every render loads again. */
export function useLiveRpc<T>(
  channel: string,
  read: () => Promise<T>,
  subscribe?: (reload: () => void) => () => void,
): [T | null, () => void, RpcLoadStatus] {
  const connection = useRealtimeConnectionState();
  const [value, setValue] = useState<T | null>(null);
  const [connectionVersion, setConnectionVersion] = useState({ connection, generation: 0 });
  const [loadStatus, setLoadStatus] = useState<{ status: RpcLoadStatus; generation: number }>({
    status: "loading",
    generation: 0,
  });
  // Adjust before commit: a connected render must not publish pre-reconnect readiness.
  if (connection !== connectionVersion.connection) {
    setConnectionVersion({
      connection,
      generation:
        connectionVersion.generation +
        (connection === "connected" && connectionVersion.connection === "reconnecting" ? 1 : 0),
    });
  }
  const { generation } = connectionVersion;
  const reload = useRef(() => {});
  useRealtime(channel, () => reload.current());
  useEffect(() => {
    let current = true;
    let latestLoad = 0;
    const load = () => {
      const thisLoad = ++latestLoad;
      setLoadStatus({ status: "loading", generation });
      read()
        .then((result) => {
          if (current && thisLoad === latestLoad) {
            setValue(result);
            setLoadStatus({ status: "ready", generation });
          }
        })
        .catch(() => {
          if (current && thisLoad === latestLoad) setLoadStatus({ status: "error", generation });
        });
    };
    reload.current = load;
    load();
    const unsubscribe = subscribe?.(load);
    return () => {
      current = false;
      reload.current = () => {};
      unsubscribe?.();
    };
  }, [read, subscribe, generation]);
  return [
    value,
    useCallback(() => reload.current(), []),
    connection === "connected" && loadStatus.generation === generation
      ? loadStatus.status
      : "loading",
  ];
}
