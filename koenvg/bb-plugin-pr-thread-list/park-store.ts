import type Database from "better-sqlite3";

export const PARK_MIGRATIONS = [
  `CREATE TABLE parks (thread_id TEXT PRIMARY KEY, parked_at INTEGER NOT NULL);`,
];

export function createParkStore(db: Database.Database) {
  const all = db.prepare<[], { thread_id: string }>(
    "SELECT thread_id FROM parks ORDER BY thread_id",
  );
  const insert = db.prepare<[string, number]>(
    "INSERT INTO parks (thread_id, parked_at) VALUES (?, ?) ON CONFLICT (thread_id) DO NOTHING",
  );
  const remove = db.prepare<[string]>("DELETE FROM parks WHERE thread_id = ?");
  const removeAll = db.transaction(
    (ids: readonly string[]) => ids.filter((id) => remove.run(id).changes > 0).length > 0,
  );
  return {
    list: () => all.all().map((row) => row.thread_id),
    add: (threadId: string, at: number) => insert.run(threadId, at).changes > 0,
    remove: (ids: readonly string[]) => removeAll(ids),
  };
}
