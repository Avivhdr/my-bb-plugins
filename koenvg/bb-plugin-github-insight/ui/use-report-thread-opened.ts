import { useCallback, useEffect } from "react";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { LoadedReviewQueue, rpcContract } from "../contract";
import { readReviewQueueUpdate, REVIEW_QUEUE_UPDATED_CHANNEL } from "../core/review-queue-updated";

function cameBackWhileOpen(update: LoadedReviewQueue, threadId: string): boolean {
  const view = update.kind === "ok" ? update : update.lastGood;
  if (view === null) return false;
  return [...view.needsReview, ...view.reviewed].some((group) =>
    group.prs.some(
      ({ thread }) =>
        thread?.id === threadId && (thread.returned === "finished" || thread.returned === "failed"),
    ),
  );
}

export function useReportThreadOpened(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const report = useCallback(() => {
    rpc.call("markThreadOpened", { threadId }).catch(() => {});
  }, [rpc, threadId]);

  useEffect(report, [report]);

  useRealtime(REVIEW_QUEUE_UPDATED_CHANNEL, (payload) => {
    const update = readReviewQueueUpdate(payload);
    if (update !== null && cameBackWhileOpen(update, threadId)) report();
  });
}
