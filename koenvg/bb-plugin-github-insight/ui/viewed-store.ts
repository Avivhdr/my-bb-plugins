import type { ActionResult } from "../contract";
import type { ViewedMarks } from "../core/viewed-marks";
import { messageOf } from "./error-message";

interface Override {
  identity: string | null;
  write: number;
  state: "pending" | "saved" | "unconfirmed";
  previous: Override | undefined;
}

export interface ViewedEntry {
  seen: ViewedMarks | null;
  overrides: ReadonlyMap<string, Override>;
  collapsed: ReadonlyMap<string, boolean>;
  error: string | null;
}

type Save = () => Promise<ActionResult>;

const EMPTY_ENTRY: ViewedEntry = {
  seen: null,
  overrides: new Map(),
  collapsed: new Map(),
  error: null,
};

export function effectiveMarks(entry: ViewedEntry, base: ViewedMarks): ViewedMarks {
  if (entry.overrides.size === 0) return base;
  const marks: Record<string, string> = { ...base };
  for (const [path, { identity }] of entry.overrides) {
    if (identity === null) delete marks[path];
    else marks[path] = identity;
  }
  return marks;
}

async function saveError(save: Save): Promise<string | null> {
  const result = await save().catch((error: unknown) => ({
    kind: "error" as const,
    message: messageOf(error),
  }));
  return result.kind === "error" ? `Could not save viewed state: ${result.message}` : null;
}

function without<V>(map: ReadonlyMap<string, V>, paths: readonly string[]): Map<string, V> {
  const next = new Map(map);
  for (const path of paths) next.delete(path);
  return next;
}

function afterLoad(
  overrides: ReadonlyMap<string, Override>,
  marks: ViewedMarks,
): Map<string, Override> {
  const next = new Map<string, Override>();
  for (const [path, override] of overrides) {
    if (override.state === "pending") next.set(path, override);
    else if (override.state === "saved" && (marks[path] ?? null) !== override.identity)
      next.set(path, { ...override, state: "unconfirmed" });
  }
  return next;
}

type Settle = (override: Override) => Override | undefined;

function settleChain(override: Override, write: number, settle: Settle): Override | undefined {
  if (override.write === write) return settle(override);
  if (override.previous === undefined) return override;
  return { ...override, previous: settleChain(override.previous, write, settle) };
}

export function createViewedStore() {
  const entries = new Map<string, ViewedEntry>();
  const listeners = new Set<() => void>();
  let writes = 0;

  function get(threadId: string): ViewedEntry {
    return entries.get(threadId) ?? EMPTY_ENTRY;
  }

  function update(threadId: string, change: (entry: ViewedEntry) => ViewedEntry) {
    entries.set(threadId, change(get(threadId)));
    for (const listener of listeners) listener();
  }

  function startWrite(threadId: string, changes: Record<string, string | null>) {
    const write = ++writes;
    const paths = Object.keys(changes);
    update(threadId, (entry) => {
      const overrides = new Map(entry.overrides);
      for (const path of paths)
        overrides.set(path, {
          identity: changes[path]!,
          write,
          state: "pending",
          previous: entry.overrides.get(path),
        });
      return { ...entry, overrides, collapsed: without(entry.collapsed, paths) };
    });
    return write;
  }

  function settleWrite(threadId: string, write: number, settle: Settle, error: string | null) {
    update(threadId, (entry) => {
      const overrides = new Map(entry.overrides);
      for (const [path, override] of entry.overrides) {
        const settled = settleChain(override, write, settle);
        if (settled === undefined) overrides.delete(path);
        else overrides.set(path, settled);
      }
      return { ...entry, overrides, error: error ?? entry.error };
    });
  }

  const saved = (override: Override): Override => ({
    ...override,
    state: "saved",
    previous: undefined,
  });

  return {
    get,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    loaded(threadId: string, marks: ViewedMarks) {
      if (get(threadId).seen === marks) return;
      update(threadId, (entry) => ({
        ...entry,
        seen: marks,
        overrides: afterLoad(entry.overrides, marks),
      }));
    },
    setCollapsed(threadId: string, path: string, collapsed: boolean) {
      update(threadId, (entry) => ({
        ...entry,
        collapsed: new Map(entry.collapsed).set(path, collapsed),
      }));
    },
    async setViewed(threadId: string, path: string, identity: string | null, save: Save) {
      update(threadId, (entry) => ({ ...entry, error: null }));
      const write = startWrite(threadId, { [path]: identity });
      const error = await saveError(save);
      settleWrite(threadId, write, error === null ? saved : (override) => override.previous, error);
    },
    async prune(threadId: string, paths: readonly string[], save: Save) {
      const write = startWrite(threadId, Object.fromEntries(paths.map((path) => [path, null])));
      settleWrite(threadId, write, saved, await saveError(save));
    },
  };
}

export const viewedFiles = createViewedStore();
