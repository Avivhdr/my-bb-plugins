import type { IconName } from "@/components/ui/icon";
import { AUTO_MERGE_METHOD_LABEL } from "../core/auto-merge";
import { bannerParts } from "../core/banner";
import type { Blocker } from "../core/blockers";
import type { RunnableMergeAction } from "../core/merge-action";
import type { PrInsight } from "../core/overview";
import { blockerTone } from "./blocker-tone";

export interface StatusRow {
  text: string;
  icon: IconName;
  iconClassName: string;
  textClassName?: string;
}
export type StatusDetail = StatusRow & { kind: "queue" | "blockers" | "ready" };
export interface PrStatusView {
  lifecycle: StatusRow;
  detail: StatusDetail | null;
  action: RunnableMergeAction | null;
  blockers: readonly Blocker[];
}

const LIFECYCLE: Record<PrInsight["pr"]["state"], StatusRow> = {
  open: { text: "Open", icon: "GitPullRequest", iconClassName: "text-muted-foreground" },
  draft: { text: "Draft", icon: "GitPullRequest", iconClassName: "text-muted-foreground" },
  closed: { text: "Closed", icon: "GitPullRequest", iconClassName: "text-muted-foreground" },
  merged: {
    text: "Pull request merged",
    icon: "GitMerge",
    iconClassName: "text-violet-700 [.dark_&]:text-violet-300",
  },
};

const QUEUE_ROW: Record<
  NonNullable<PrInsight["mergeQueue"]>["state"],
  (position: number) => StatusDetail
> = {
  queued: (position) => ({
    kind: "queue",
    text: `In merge queue (#${position})`,
    icon: "Circle",
    iconClassName: "text-muted-foreground",
  }),
  awaiting_checks: (position) => ({
    kind: "queue",
    text: `Merge queue checks running (#${position})`,
    icon: "Spinner",
    iconClassName: "text-attention",
  }),
  merging: () => ({
    kind: "queue",
    text: "Merging",
    icon: "CircleCheck",
    iconClassName: "text-success",
  }),
  failed: () => ({
    kind: "queue",
    text: "Merge queue failed",
    icon: "CircleX",
    iconClassName: "text-destructive",
    textClassName: "text-destructive",
  }),
};

/** Lifecycle governs visibility. Merge detail never changes that lifecycle. */
export function prStatusView(insight: PrInsight): PrStatusView {
  const lifecycle = LIFECYCLE[insight.pr.state];
  const status: PrStatusView = { lifecycle, detail: null, action: null, blockers: [] };
  if (insight.pr.state === "closed" || insight.pr.state === "merged") return status;
  if (insight.pr.state === "open") {
    if (insight.mergeQueue !== null) {
      status.detail = QUEUE_ROW[insight.mergeQueue.state](insight.mergeQueue.position);
      return status;
    }
    if (insight.mergeAction.kind === "queued") {
      status.detail = {
        kind: "queue",
        text: "In merge queue",
        icon: "Circle",
        iconClassName: "text-muted-foreground",
      };
      return status;
    }
  }

  status.blockers = insight.blockers;
  const compactBlockers = listedBlockers(insight.blockers);
  const parts = bannerParts({ ...insight, blockers: compactBlockers });
  if (parts.length > 0) {
    status.detail = {
      kind: "blockers",
      text: parts.join(" · "),
      icon: "AlertCircle",
      iconClassName: blockerTone(compactBlockers[0]!.code),
    };
  } else if (
    insight.pr.state === "open" &&
    insight.blockers.length === 0 &&
    (insight.mergeAction.kind === "merge" || insight.mergeAction.kind === "enqueue")
  ) {
    status.action = insight.mergeAction;
    status.detail = {
      kind: "ready",
      text: insight.mergeAction.kind === "enqueue" ? "Ready to enqueue" : "Ready to merge",
      icon: "CircleCheck",
      iconClassName: "text-success",
    };
  }
  return status;
}

export type SummaryLine = StatusRow & { more: number };

export function listedBlockers(blockers: readonly Blocker[]): Blocker[] {
  return blockers.filter((blocker) => blocker.code !== "draft");
}

export function prSummaryLine(insight: PrInsight): SummaryLine | null {
  if (insight.pr.state === "closed" || insight.pr.state === "merged") return null;
  const { detail } = prStatusView(insight);
  if (detail?.kind === "queue") return { ...detail, more: 0 };
  if (insight.autoMergeAction.kind === "disable") {
    return {
      text: `Auto-merge on (${AUTO_MERGE_METHOD_LABEL[insight.autoMergeAction.method]})`,
      icon: "GitMerge",
      iconClassName: "text-success",
      more: 0,
    };
  }
  const [first, ...rest] = listedBlockers(insight.blockers);
  if (first !== undefined) {
    return {
      text: first.text,
      icon: "AlertCircle",
      iconClassName: blockerTone(first.code),
      more: rest.length,
    };
  }
  return detail?.kind === "ready" ? { ...detail, more: 0 } : null;
}
