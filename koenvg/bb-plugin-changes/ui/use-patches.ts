import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { messageOf, type ChangesResult } from "../core/changes";

export type PatchState =
  | { kind: "loaded"; patch: string }
  | { kind: "loading" }
  | { kind: "error"; message: string };

export type LoadedChanges = Extract<ChangesResult, { kind: "ok" }>;

export interface Patches {
  stateOf(path: string): PatchState;
  currentPatch(path: string): string | null;
  load(path: string): void;
}

interface Entry {
  state: PatchState;
  changes: LoadedChanges;
}

export function usePatches(threadId: string, changes: LoadedChanges | null): Patches {
  const rpc = useRpc<typeof rpcContract>();
  const [entries, setEntries] = useState<ReadonlyMap<string, Entry>>(new Map());
  const requested = useRef(new WeakMap<LoadedChanges, Set<string>>());
  const batch = useRef<{ changes: LoadedChanges; paths: Set<string> } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const flush = useCallback(
    async (source: LoadedChanges, paths: string[]) => {
      const result = await rpc
        .call("getPatches", { threadId, query: source.query, paths })
        .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
      if (!mounted.current) return;
      setEntries((previous) => {
        const next = new Map(previous);
        for (const path of paths) {
          const patch = result.kind === "ok" ? result.patches[path] : undefined;
          const state: PatchState =
            result.kind === "error"
              ? result
              : patch === undefined
                ? { kind: "error", message: "Diff not available" }
                : { kind: "loaded", patch };
          next.set(path, { state, changes: source });
        }
        return next;
      });
    },
    [rpc, threadId],
  );

  const load = useCallback(
    (path: string) => {
      if (changes === null) return;
      const paths = requested.current.get(changes) ?? new Set<string>();
      requested.current.set(changes, paths);
      if (paths.has(path) || changes.patches[path] !== undefined) return;
      paths.add(path);
      if (batch.current?.changes === changes) {
        batch.current.paths.add(path);
        return;
      }
      const pending = { changes, paths: new Set([path]) };
      batch.current = pending;
      queueMicrotask(() => {
        if (batch.current === pending) batch.current = null;
        void flush(pending.changes, [...pending.paths]);
      });
    },
    [changes, flush],
  );

  const stateOf = useCallback(
    (path: string): PatchState => {
      const initial = changes?.patches[path];
      if (initial !== undefined) return { kind: "loaded", patch: initial };
      const entry = entries.get(path);
      if (entry === undefined) return { kind: "loading" };
      // A patch from the previous load stays on screen until its refreshed patch arrives.
      if (entry.changes !== changes && entry.state.kind !== "loaded") return { kind: "loading" };
      return entry.state;
    },
    [changes, entries],
  );

  const currentPatch = useCallback(
    (path: string): string | null => {
      const initial = changes?.patches[path];
      if (initial !== undefined) return initial;
      const entry = entries.get(path);
      return entry?.changes === changes && entry.state.kind === "loaded" ? entry.state.patch : null;
    },
    [changes, entries],
  );

  return useMemo(() => ({ stateOf, currentPatch, load }), [stateOf, currentPatch, load]);
}
