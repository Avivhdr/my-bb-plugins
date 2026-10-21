import type { BbPluginApi } from "@get-bb/plugin-sdk";

export interface SnoozeThread {
  id: string;
  parentThreadId: string | null;
  isArchived: boolean;
  isHidden: boolean;
}

type ServerThread = Pick<
  Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number],
  "id" | "parentThreadId" | "archivedAt" | "visibility"
>;

export const snoozeThreadFromServer = (row: ServerThread): SnoozeThread => ({
  id: row.id,
  parentThreadId: row.parentThreadId,
  isArchived: row.archivedAt !== null,
  isHidden: row.visibility === "hidden",
});

/** Fetch both lifecycles: excluded parents can still connect active descendants. */
export async function listSnoozeThreads(threads: {
  list(args: {
    archived: boolean;
    includeHidden: boolean;
    limit: number;
    offset: number;
  }): Promise<readonly ServerThread[]>;
}): Promise<SnoozeThread[]> {
  const rows = new Map<string, SnoozeThread>();
  for (const archived of [false, true]) {
    for (let offset = 0; ; offset += 100) {
      const page = await threads.list({ archived, includeHidden: true, limit: 100, offset });
      for (const row of page) rows.set(row.id, snoozeThreadFromServer(row));
      if (page.length < 100) break;
    }
  }
  return [...rows.values()];
}

/** Captured membership, independent of sidebar grouping, collapse, and projects. */
export function subtreeMembers<T extends SnoozeThread>(
  threads: readonly T[],
  selectedId: string,
): T[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const children = new Map<string, string[]>();
  for (const thread of threads) {
    if (thread.parentThreadId === null) continue;
    const ids = children.get(thread.parentThreadId) ?? [];
    ids.push(thread.id);
    children.set(thread.parentThreadId, ids);
  }
  const pending = [selectedId],
    visited = new Set<string>(),
    members: T[] = [];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const thread = byId.get(id);
    if (!thread) continue;
    if (!thread.isArchived && !thread.isHidden) members.push(thread);
    pending.push(...(children.get(id) ?? []));
  }
  return members;
}
