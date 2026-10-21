import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { ReviewFile } from "../core/pr-files";
import { fileIdentities, viewedSummary, type ViewedMarks } from "../core/viewed-marks";
import { effectiveMarks, viewedFiles } from "./viewed-store";

export interface FileViewedState {
  viewed: boolean;
  collapsed: boolean;
  toggleViewed(): void;
  toggleCollapsed(): void;
}

export interface PrViewed {
  counts: { viewed: number; markable: number };
  error: string | null;
  of(file: ReviewFile): FileViewedState | undefined;
}

export function usePrViewed(
  threadId: string,
  files: readonly ReviewFile[],
  storedMarks: ViewedMarks,
  pathsWithNewComments: ReadonlySet<string>,
): PrViewed {
  const rpc = useRpc<typeof rpcContract>();
  const read = useCallback(() => viewedFiles.get(threadId), [threadId]);
  const entry = useSyncExternalStore(viewedFiles.subscribe, read);

  useEffect(() => viewedFiles.loaded(threadId, storedMarks), [threadId, storedMarks]);

  const identities = useMemo(() => fileIdentities(files), [files]);
  const summary = useMemo(
    () => viewedSummary(identities, effectiveMarks(entry, storedMarks)),
    [identities, entry, storedMarks],
  );

  useEffect(() => {
    if (summary.stale.length === 0) return;
    const remove = [...summary.stale];
    void viewedFiles.prune(threadId, remove, () =>
      rpc.call("updateViewed", { threadId, set: {}, remove }),
    );
  }, [rpc, threadId, summary]);

  function setViewed(path: string, identity: string | null) {
    void viewedFiles.setViewed(threadId, path, identity, () =>
      rpc.call("updateViewed", {
        threadId,
        set: identity === null ? {} : { [path]: identity },
        remove: identity === null ? [path] : [],
      }),
    );
  }

  return {
    counts: { viewed: summary.viewed.size, markable: summary.markable },
    error: entry.error,
    of(file) {
      const identity = identities.get(file.path) ?? null;
      if (identity === null) return undefined;
      const viewed = summary.viewed.has(file.path);
      const collapsed =
        entry.collapsed.get(file.path) ?? (viewed && !pathsWithNewComments.has(file.path));
      return {
        viewed,
        collapsed,
        toggleViewed: () => setViewed(file.path, viewed ? null : identity),
        toggleCollapsed: () => viewedFiles.setCollapsed(threadId, file.path, !collapsed),
      };
    },
  };
}
