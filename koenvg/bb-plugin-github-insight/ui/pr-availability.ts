import type { InsightResult } from "../contract";
import { prStatusView } from "./pr-status-view";

type OkInsightResult = Extract<InsightResult, { kind: "ok" }>;

const snapshots = new Map<string, OkInsightResult>();

export function rememberInsight(threadId: string, result: InsightResult): void {
  if (result.kind === "ok") snapshots.set(threadId, { ...result, error: null });
  else if (result.kind === "no_pr") snapshots.delete(threadId);
}

export function insightSnapshot(threadId: string): OkInsightResult | null {
  return snapshots.get(threadId) ?? null;
}

export function hasPr(threadId: string): boolean {
  return snapshots.has(threadId);
}

export function canMerge(threadId: string): boolean {
  const snapshot = snapshots.get(threadId);
  return snapshot !== undefined && prStatusView(snapshot.insight).action !== null;
}

export function forgetInsights(): void {
  snapshots.clear();
}
