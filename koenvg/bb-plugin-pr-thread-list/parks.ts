import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { PARKS_CHANGED_CHANNEL } from "./contract";
import { createParkStore } from "./park-store";
import { listSnoozeThreads, type SnoozeThread } from "./snooze-tree";

/** The thread, its ancestors, and its descendants, whatever their lifecycle. */
export function lineage(threads: readonly SnoozeThread[], threadId: string): string[] {
  const parentOf = new Map(threads.map((thread) => [thread.id, thread.parentThreadId]));
  const ids = new Set<string>();
  for (let id: string | null | undefined = threadId; id && !ids.has(id); id = parentOf.get(id))
    ids.add(id);
  const pending = [threadId];
  while (pending.length) {
    const id = pending.pop()!;
    for (const thread of threads)
      if (thread.parentThreadId === id && !ids.has(thread.id)) {
        ids.add(thread.id);
        pending.push(thread.id);
      }
  }
  return [...ids];
}

export function registerParks(bb: BbPluginApi, now: () => number = Date.now) {
  const store = createParkStore(bb.storage.database());
  const changed = () => bb.realtime.publish(PARKS_CHANGED_CHANNEL, {});

  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      if (store.remove([thread.id])) changed();
    });
  }

  return {
    listParks: () => ({ threadIds: store.list() }),
    park: async ({ threadId }: { threadId: string }) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (thread.archivedAt !== null || thread.visibility === "hidden")
        throw new Error("The selected thread cannot move to Later.");
      if (store.add(threadId, now())) changed();
      return {};
    },
    unpark: async ({ threadId }: { threadId: string }) => {
      const threads = await listSnoozeThreads(bb.sdk.threads);
      if (store.remove(lineage(threads, threadId))) changed();
      return {};
    },
  };
}
