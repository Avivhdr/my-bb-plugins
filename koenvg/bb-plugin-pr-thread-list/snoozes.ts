import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { MAX_SNOOZE_MS, SNOOZES_CHANGED_CHANNEL } from "./contract";
import { createSnoozeStore, SNOOZE_MIGRATIONS } from "./snooze-store";
import { listSnoozeThreads, subtreeMembers } from "./snooze-tree";
import { createSnoozeLifecycle } from "./snooze-lifecycle";

export const SNOOZE_WAKE_SCHEDULE = "snooze-wake";

export function registerSnoozes(bb: BbPluginApi, now: () => number = Date.now) {
  const db = bb.storage.database();
  bb.storage.migrate(db, SNOOZE_MIGRATIONS);
  const store = createSnoozeStore(db);
  const changed = () => bb.realtime.publish(SNOOZES_CHANGED_CHANNEL, {});
  const lifecycle = createSnoozeLifecycle();
  const endSnooze = (threadId: string) => {
    if (store.endGroup(threadId)) changed();
  };

  for (const event of ["thread.idle", "thread.failed"] as const) {
    bb.events.on(event, ({ thread }) => {
      lifecycle.signal(thread.id);
      endSnooze(thread.id);
    });
  }
  for (const event of ["thread.archived", "thread.unarchived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      lifecycle.remove(thread.id);
      if (store.delete(thread.id)) changed();
    });
  }
  bb.background.schedule(SNOOZE_WAKE_SCHEDULE, "* * * * *", () =>
    lifecycle.exclusive(async () => {
      const at = now();
      const due = store.due(at);
      let ended = false;
      for (const group of due) {
        for (const threadId of group.threadIds) {
          try {
            const thread = await bb.sdk.threads.get({ threadId });
            if (
              store.owns(threadId, group.id) &&
              thread.archivedAt === null &&
              thread.deletedAt === null
            )
              await bb.sdk.threads.markUnread({ threadId });
          } catch {
            // A deleted member must not prevent the remaining group from waking.
          }
        }
        ended = store.deleteDue(group.id, at) || ended;
      }
      if (ended) changed();
    }),
  );

  return {
    listSnoozes: () => store.snapshot(),
    snooze: async ({ threadId, wakeAt }: { threadId: string; wakeAt: number }) => {
      const at = now();
      if (wakeAt <= at || wakeAt > at + MAX_SNOOZE_MS)
        throw new Error("The wake time must be within the next 30 days.");
      await lifecycle.snooze(
        async () => {
          const threads = await listSnoozeThreads(bb.sdk.threads);
          const selected = threads.find(({ id }) => id === threadId);
          if (!selected || selected.isArchived || selected.isHidden)
            throw new Error("The selected thread is not available for snooze.");
          return subtreeMembers(threads, threadId).map(({ id }) => id);
        },
        async (action) => {
          for (const memberId of action.members)
            await bb.sdk.threads.markRead({ threadId: memberId });
          if (action.members.size) {
            store.replaceGroup([...action.members], wakeAt, at);
            if (action.signalled) store.endGroup([...action.members][0]!);
          }
          changed();
        },
      );
      return {};
    },
    wake: ({ threadId }: { threadId: string }) => {
      endSnooze(threadId);
      return {};
    },
  };
}
