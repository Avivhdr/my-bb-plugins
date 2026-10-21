import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contract";
import { SNOOZES_CHANGED_CHANNEL, snoozesSchema } from "./contract-schemas";
import { useLiveRpc } from "./live-rpc";
import { activeSnoozes, canSnoozeSubtree, snoozesToEnd, type SnoozeControls } from "./snooze-model";

const NONE: Readonly<Record<string, number>> = {};
const NO_GROUPS: Readonly<Record<string, string>> = {};

export function useSnoozes(
  threads: readonly PluginSidebarThread[],
  now: number,
  threadsReady = true,
): SnoozeControls & {
  ready: boolean;
  values: Readonly<Record<string, number>>;
  groups: Readonly<Record<string, string>>;
} {
  const rpc = useRpc<typeof rpcContract>();
  const read = useCallback(
    async () => snoozesSchema.parse(await rpc.call("listSnoozes", {})),
    [rpc],
  );
  const [result, reload, status] = useLiveRpc(SNOOZES_CHANGED_CHANNEL, read);
  const snoozes = result?.snoozes ?? NONE;
  const groups = result?.groups ?? NO_GROUPS;
  const wake = useCallback(
    (threadId: string) => rpc.call("wake", { threadId }).then(reload),
    [rpc, reload],
  );
  const snooze = useCallback(
    (threadId: string, wakeAt: number) => rpc.call("snooze", { threadId, wakeAt }).then(reload),
    [rpc, reload],
  );
  const snoozed = useMemo(
    () => activeSnoozes(threads, snoozes, now, groups),
    [threads, snoozes, now, groups],
  );
  const canSnooze = useCallback(
    (id: string) =>
      threadsReady &&
      status === "ready" &&
      canSnoozeSubtree(threads, id) &&
      !activeSnoozes(threads, snoozes, Date.now(), groups).has(id),
    [threadsReady, status, threads, snoozes, groups],
  );
  const ending = useRef(new Set<string>());
  useEffect(() => {
    const storedGroups = new Set(Object.values(groups));
    for (const group of ending.current) if (!storedGroups.has(group)) ending.current.delete(group);
    if (!threadsReady || status !== "ready") return;
    for (const id of snoozesToEnd(threads, snoozes, groups)) {
      const group = groups[id]!;
      if (ending.current.has(group)) continue;
      ending.current.add(group);
      void wake(id).catch(() => ending.current.delete(group));
    }
  }, [threads, threadsReady, status, snoozes, groups, wake]);
  return useMemo(
    () => ({
      snoozed,
      snooze,
      wake,
      canSnooze,
      ready: status === "ready",
      values: snoozes,
      groups,
    }),
    [snoozed, snooze, wake, canSnooze, status, snoozes, groups],
  );
}
