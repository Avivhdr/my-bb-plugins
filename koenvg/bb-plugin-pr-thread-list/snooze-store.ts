import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Snoozes } from "./contract";

export const SNOOZE_MIGRATIONS = [
  `CREATE TABLE snoozes (thread_id TEXT PRIMARY KEY, wake_at INTEGER NOT NULL, snoozed_at INTEGER NOT NULL);
   CREATE INDEX snoozes_wake_at ON snoozes (wake_at);`,
  `ALTER TABLE snoozes ADD COLUMN group_id TEXT;
   UPDATE snoozes SET group_id = 'legacy:' || lower(hex(randomblob(16)));
   CREATE INDEX snoozes_group_id ON snoozes (group_id);`,
];

export interface DueSnoozeGroup {
  id: string;
  wakeAt: number;
  threadIds: string[];
}
type Row = { thread_id: string; wake_at: number; group_id: string };

export function createSnoozeStore(db: Database.Database) {
  // Older versions leave group IDs intact when updating an existing row.
  // Dissolve inconsistent groups on re-upgrade without changing their times.
  db.exec(`UPDATE snoozes SET group_id = 'legacy:' || lower(hex(randomblob(16)))
    WHERE group_id IS NULL OR group_id IN (
      SELECT group_id FROM snoozes GROUP BY group_id
      HAVING min(wake_at) <> max(wake_at) OR min(snoozed_at) <> max(snoozed_at))`);
  const all = db.prepare<[], Row>(
    "SELECT thread_id, wake_at, group_id FROM snoozes ORDER BY thread_id",
  );
  const upsert = db.prepare<[string, number, number, string]>(
    `INSERT INTO snoozes (thread_id, wake_at, snoozed_at, group_id) VALUES (?, ?, ?, ?)
     ON CONFLICT (thread_id) DO UPDATE SET wake_at = excluded.wake_at, snoozed_at = excluded.snoozed_at, group_id = excluded.group_id`,
  );
  const replace = db.transaction(
    (ids: readonly string[], wakeAt: number, snoozedAt: number, groupId: string) => {
      for (const id of ids) upsert.run(id, wakeAt, snoozedAt, groupId);
    },
  );
  const remove = db.prepare<[string]>("DELETE FROM snoozes WHERE thread_id = ?");
  const endGroup = db.prepare<[string]>(
    "DELETE FROM snoozes WHERE group_id = (SELECT group_id FROM snoozes WHERE thread_id = ?)",
  );
  const due = db.prepare<[number], Row>(
    "SELECT thread_id, wake_at, group_id FROM snoozes WHERE wake_at <= ? ORDER BY thread_id",
  );
  const removeDue = db.prepare<[string, number]>(
    "DELETE FROM snoozes WHERE group_id = ? AND wake_at <= ?",
  );
  const owns = db.prepare<[string, string]>(
    "SELECT 1 FROM snoozes WHERE thread_id = ? AND group_id = ?",
  );
  return {
    snapshot(): Snoozes {
      const rows = all.all();
      return {
        snoozes: Object.fromEntries(rows.map((row) => [row.thread_id, row.wake_at])),
        groups: Object.fromEntries(rows.map((row) => [row.thread_id, row.group_id])),
      };
    },
    replaceGroup(ids: readonly string[], wakeAt: number, snoozedAt: number): string {
      const id = randomUUID();
      replace(ids, wakeAt, snoozedAt, id);
      return id;
    },
    delete: (threadId: string) => remove.run(threadId).changes > 0,
    endGroup: (threadId: string) => endGroup.run(threadId).changes > 0,
    owns: (threadId: string, groupId: string) => owns.get(threadId, groupId) !== undefined,
    due(now: number): DueSnoozeGroup[] {
      const groups = new Map<string, DueSnoozeGroup>();
      for (const row of due.all(now)) {
        const group = groups.get(row.group_id) ?? {
          id: row.group_id,
          wakeAt: row.wake_at,
          threadIds: [],
        };
        group.threadIds.push(row.thread_id);
        groups.set(row.group_id, group);
      }
      return [...groups.values()];
    },
    deleteDue: (groupId: string, now: number) => removeDue.run(groupId, now).changes > 0,
  };
}
