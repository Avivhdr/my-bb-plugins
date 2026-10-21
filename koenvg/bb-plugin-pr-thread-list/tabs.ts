import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BlockerCode, PrSummary } from "./pr-insight";
import { isActive, needsAttention } from "./row-cues";

export type AttentionTab = "attention" | "inflight";
export type Tab = AttentionTab | "all";

const PROBLEMS: readonly BlockerCode[] = [
  "conflicts",
  "checks_failed",
  "checks_waiting",
  "changes_requested",
  "unresolved_threads",
];
const WAITING: readonly BlockerCode[] = ["checks_running", "review_required"];

export function threadsWithActiveDescendant(threads: readonly PluginSidebarThread[]): Set<string> {
  const parentOf = new Map(threads.map((t) => [t.id, t.parentThreadId]));
  const marked = new Set<string>();
  for (const thread of threads) {
    if (thread.isArchived || thread.isHidden || !isActive(thread)) continue;
    const seen = new Set([thread.id]);
    let parentId = parentOf.get(thread.id);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      marked.add(parentId);
      parentId = parentOf.get(parentId);
    }
  }
  return marked;
}

type AttentionReason = "urgent" | "settled";

function attentionReason(
  thread: PluginSidebarThread,
  pr: PrSummary | null,
  hasActiveDescendant: boolean,
): AttentionReason | null {
  if (needsAttention(thread) || thread.isUnread) return "urgent";
  if (isActive(thread) || hasActiveDescendant) return null;
  if (!pr) return "settled";
  if (pr.mergeQueue) return pr.mergeQueue.state === "failed" ? "urgent" : null;
  if (pr.blockers.some((code) => PROBLEMS.includes(code))) return "urgent";
  if (
    pr.state === "open" &&
    (pr.runningChecks > 0 || pr.blockers.some((code) => WAITING.includes(code)))
  )
    return null;
  return "settled";
}

export const tabFor = (
  thread: PluginSidebarThread,
  pr: PrSummary | null,
  hasActiveDescendant: boolean,
): AttentionTab => (attentionReason(thread, pr, hasActiveDescendant) ? "attention" : "inflight");

export function pullsTreeToAttention(
  thread: PluginSidebarThread,
  pr: PrSummary | null,
  hasActiveDescendant: boolean,
  isTop: boolean,
): boolean {
  const reason = attentionReason(thread, pr, hasActiveDescendant);
  return reason !== null && (isTop || reason !== "settled");
}
