import { countedPrs, type LinkedQueuePr, type ReviewQueueView } from "./review-queue-view";

export interface ReviewBadge {
  /** Waiting PRs with no review under way or ready: nothing ran, it failed, or you opened it. */
  waiting: string | null;
  /** Waiting PRs whose review agent runs or asks you something. */
  inProgress: number;
  /** Waiting PRs whose review agent finished and you have not opened its thread yet. */
  ready: number;
  unseen: boolean;
  returned: boolean;
}

type Stage = "waiting" | "in_progress" | "ready";

function stageOf({ thread }: LinkedQueuePr): Stage {
  if (thread === null || thread.returned === "failed") return "waiting";
  if (thread.returned === "finished") return "ready";
  return thread.status === "running" || thread.status === "needs_you" ? "in_progress" : "waiting";
}

/** Splits the PRs waiting in the layers by review stage. Reviewed, merged, and ignored PRs never count. */
export function reviewBadge(view: ReviewQueueView | null): ReviewBadge | null {
  if (view === null) return null;
  const total = view.layers.reduce((sum, layer) => sum + layer.count, 0);
  if (total === 0 && !view.hasReturned) return null;
  const stages = view.layers.flatMap(countedPrs).map(stageOf);
  const inProgress = stages.filter((stage) => stage === "in_progress").length;
  const ready = stages.filter((stage) => stage === "ready").length;
  const waiting = total - inProgress - ready;
  const truncated = view.layers.some((layer) => layer.truncated);
  return {
    waiting: waiting === 0 ? null : truncated ? `${waiting}+` : String(waiting),
    inProgress,
    ready,
    unseen: view.hasUnseen,
    returned: view.hasReturned,
  };
}
