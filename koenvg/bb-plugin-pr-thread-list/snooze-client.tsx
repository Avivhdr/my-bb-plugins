import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { activeSnoozes, canSnoozeSubtree, type SnoozeControls } from "./snooze-model";
import { useSnoozes } from "./use-snoozes";
import { useNow } from "./use-now";

export interface SnoozeSnapshot {
  threads: readonly PluginSidebarThread[];
  threadsReady: boolean;
  snoozes: Readonly<Record<string, number>>;
  groups: Readonly<Record<string, string>>;
  snoozesReady: boolean;
  controls: SnoozeControls | null;
}

const STOPPED: SnoozeSnapshot = {
  threads: [],
  threadsReady: false,
  snoozes: {},
  groups: {},
  snoozesReady: false,
  controls: null,
};
const NO_CONTROLS: SnoozeControls = {
  snoozed: new Map(),
  canSnooze: () => false,
  snooze: async () => {},
  wake: async () => {},
};

/** One store per frontend registration, shared by the overlay, list, and commands. */
export function createSnoozeClient() {
  let snapshot = STOPPED;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: SnoozeSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      const token = ++generation;
      let currentControls: SnoozeControls | null = null;
      const ready = () => token === generation && snapshot.threadsReady && snapshot.snoozesReady;
      const active = (id: string) =>
        activeSnoozes(snapshot.threads, snapshot.snoozes, Date.now(), snapshot.groups).has(id);
      const eligible = (id: string) =>
        ready() && canSnoozeSubtree(snapshot.threads, id) && !active(id);
      publish(STOPPED);
      return {
        update(next: SnoozeSnapshot) {
          if (token !== generation) return;
          currentControls = next.controls;
          publish({
            ...next,
            controls: currentControls && {
              snoozed: currentControls.snoozed,
              canSnooze: eligible,
              snooze: async (id, at) => {
                if (eligible(id)) return currentControls?.snooze(id, at);
              },
              wake: async (id) => {
                if (ready() && active(id)) return currentControls?.wake(id);
              },
            },
          });
        },
        stop() {
          if (token === generation) {
            generation++;
            publish(STOPPED);
          }
        },
      };
    },
  };
}
export type SnoozeClient = ReturnType<typeof createSnoozeClient>;

export function useSnoozeControls(client: SnoozeClient): SnoozeControls {
  return useSyncExternalStore(client.subscribe, client.getSnapshot).controls ?? NO_CONTROLS;
}

export function SnoozeOwner({ client }: { client: SnoozeClient }) {
  const {
    threads,
    status,
    experimental_archived: archived,
  } = experimental_useSidebarThreads({ experimental_lifecycles: ["active", "archived"] });
  const threadsReady =
    status === "ready" &&
    archived?.status === "ready" &&
    !archived.hasNextPage &&
    !archived.isFetchingNextPage &&
    !archived.isFetchNextPageError;
  useEffect(() => {
    if (
      status === "ready" &&
      archived?.status === "ready" &&
      archived.hasNextPage &&
      !archived.isFetchingNextPage &&
      !archived.isFetchNextPageError
    )
      void archived.fetchNextPage().catch(() => {});
  }, [archived, status]);
  const snoozes = useSnoozes(threads, useNow(), status === "ready");
  const owner = useRef<ReturnType<SnoozeClient["start"]> | null>(null);
  useLayoutEffect(() => {
    const lease = client.start();
    owner.current = lease;
    return () => {
      lease.stop();
      owner.current = null;
    };
  }, [client]);
  useLayoutEffect(() => {
    owner.current?.update({
      threads,
      threadsReady,
      snoozes: snoozes.values,
      groups: snoozes.groups,
      snoozesReady: snoozes.ready,
      controls: snoozes,
    });
  }, [threads, threadsReady, snoozes]);
  return null;
}
