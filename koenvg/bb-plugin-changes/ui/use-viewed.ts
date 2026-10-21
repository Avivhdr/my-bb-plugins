import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { messageOf, targetOf } from "../core/changes";
import { patchIdentity } from "../core/patch-identity";
import { canMark, viewedSummary } from "../core/viewed-files";
import { EMPTY_ENTRY, viewedFiles, viewedKey } from "../core/viewed-store";
import type { LoadedChanges, Patches } from "./use-patches";

export interface FileViewedState {
  viewed: boolean;
  collapsed: boolean;
  canToggleViewed: boolean;
  toggleViewed(): void;
  toggleCollapsed(): void;
}

export interface Viewed {
  counts: { viewed: number; markable: number } | null;
  error: string | null;
  of(path: string): FileViewedState;
}

export function useViewed(
  threadId: string,
  changes: LoadedChanges | null,
  patches: Patches,
): Viewed {
  const rpc = useRpc<typeof rpcContract>();
  const target = useMemo(() => (changes === null ? null : targetOf(changes.query)), [changes]);
  const key = target === null ? null : viewedKey(threadId, target);
  const read = useCallback(() => (key === null ? EMPTY_ENTRY : viewedFiles.get(key)), [key]);
  const entry = useSyncExternalStore(viewedFiles.subscribe, read);
  const { marks } = entry;

  useEffect(() => {
    if (key === null || target === null || marks !== null) return;
    void rpc
      .call("getViewed", { threadId, target })
      .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }))
      .then((result) => {
        if (result.kind === "ok") viewedFiles.loaded(key, result.marks);
        else viewedFiles.failed(key, `Could not load viewed state: ${result.message}`);
      });
  }, [rpc, threadId, target, key, marks]);

  useEffect(() => {
    if (changes === null || marks === null) return;
    for (const file of changes.files)
      if (marks[file.path] !== undefined && canMark(file)) patches.load(file.path);
  }, [changes, marks, patches]);

  const summary = useMemo(
    () =>
      changes === null || marks === null
        ? null
        : viewedSummary(changes.files, marks, patches.currentPatch),
    [changes, marks, patches],
  );

  useEffect(() => {
    if (key === null || target === null || summary === null || summary.stale.length === 0) return;
    const remove = [...summary.stale];
    void viewedFiles.prune(key, remove, () =>
      rpc.call("updateViewed", { threadId, target, set: {}, remove }),
    );
  }, [rpc, threadId, target, key, summary]);

  function setViewed(path: string, viewed: boolean) {
    const patch = patches.currentPatch(path);
    if (key === null || target === null || marks === null || patch === null) return;
    const identity = viewed ? patchIdentity(patch) : null;
    void viewedFiles.setViewed(key, path, identity, () =>
      rpc.call("updateViewed", {
        threadId,
        target,
        set: identity === null ? {} : { [path]: identity },
        remove: identity === null ? [path] : [],
      }),
    );
  }

  return {
    counts: summary === null ? null : { viewed: summary.viewed.size, markable: summary.markable },
    error: entry.error,
    of(path) {
      const viewed = summary?.viewed.has(path) ?? false;
      const collapsed = entry.collapsed.get(path) ?? viewed;
      return {
        viewed,
        collapsed,
        canToggleViewed: marks !== null && patches.currentPatch(path) !== null,
        toggleViewed: () => setViewed(path, !viewed),
        toggleCollapsed: () => {
          if (key !== null) viewedFiles.setCollapsed(key, path, !collapsed);
        },
      };
    },
  };
}
