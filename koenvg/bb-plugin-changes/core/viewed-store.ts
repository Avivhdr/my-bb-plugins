import { messageOf, targetKey, type DiffTarget } from "./changes";
import type { UpdateViewedResult, ViewedMarks } from "./viewed-files";

export interface ViewedEntry {
  marks: ViewedMarks | null;
  collapsed: ReadonlyMap<string, boolean>;
  error: string | null;
}

type Save = () => Promise<UpdateViewedResult>;

export const EMPTY_ENTRY: ViewedEntry = { marks: null, collapsed: new Map(), error: null };

export function viewedKey(threadId: string, target: DiffTarget): string {
  return `${threadId}\n${targetKey(target)}`;
}

function withMark(marks: ViewedMarks | null, path: string, identity: string | null): ViewedMarks {
  const next = { ...marks };
  if (identity === null) delete next[path];
  else next[path] = identity;
  return next;
}

function withoutCollapsed(collapsed: ReadonlyMap<string, boolean>, paths: readonly string[]) {
  const next = new Map(collapsed);
  for (const path of paths) next.delete(path);
  return next;
}

async function saveError(save: Save): Promise<string | null> {
  const result = await save().catch((error: unknown) => ({
    kind: "error" as const,
    message: messageOf(error),
  }));
  return result.kind === "error" ? `Could not save viewed state: ${result.message}` : null;
}

export function createViewedStore() {
  const entries = new Map<string, ViewedEntry>();
  const listeners = new Set<() => void>();
  const writes = new Map<string, number>();

  function get(key: string): ViewedEntry {
    return entries.get(key) ?? EMPTY_ENTRY;
  }

  function update(key: string, change: (entry: ViewedEntry) => ViewedEntry) {
    entries.set(key, change(get(key)));
    for (const listener of listeners) listener();
  }

  return {
    get,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loaded(key: string, marks: ViewedMarks) {
      if (get(key).marks !== null) return;
      update(key, (entry) => ({ ...entry, marks, error: null }));
    },
    failed(key: string, error: string) {
      update(key, (entry) => ({ ...entry, error }));
    },
    setCollapsed(key: string, path: string, collapsed: boolean) {
      update(key, (entry) => ({
        ...entry,
        collapsed: new Map(entry.collapsed).set(path, collapsed),
      }));
    },
    async setViewed(key: string, path: string, identity: string | null, save: Save) {
      const previous = get(key).marks?.[path] ?? null;
      const writeKey = `${key}\n${path}`;
      const write = (writes.get(writeKey) ?? 0) + 1;
      writes.set(writeKey, write);
      update(key, (entry) => ({
        marks: withMark(entry.marks, path, identity),
        collapsed: withoutCollapsed(entry.collapsed, [path]),
        error: null,
      }));
      const error = await saveError(save);
      if (error === null) return;
      if (writes.get(writeKey) !== write) update(key, (entry) => ({ ...entry, error }));
      else
        update(key, (entry) => ({ ...entry, marks: withMark(entry.marks, path, previous), error }));
    },
    async prune(key: string, paths: readonly string[], save: Save) {
      update(key, (entry) => ({
        ...entry,
        marks: Object.fromEntries(
          Object.entries(entry.marks ?? {}).filter(([path]) => !paths.includes(path)),
        ),
        collapsed: withoutCollapsed(entry.collapsed, paths),
      }));
      const error = await saveError(save);
      if (error !== null) update(key, (entry) => ({ ...entry, error }));
    },
  };
}

export const viewedFiles = createViewedStore();
