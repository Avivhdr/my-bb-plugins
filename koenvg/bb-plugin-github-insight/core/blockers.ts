import { z } from "zod";
import type { Check } from "./checks";
import type { MergeQueue } from "./merge-queue";

export const mergeableSchema = z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]);
export const mergeStateStatusSchema = z.enum([
  "BEHIND",
  "BLOCKED",
  "CLEAN",
  "DIRTY",
  "DRAFT",
  "HAS_HOOKS",
  "UNKNOWN",
  "UNSTABLE",
]);
export const reviewDecisionSchema = z
  .enum(["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"])
  .nullable();

export const blockerCodeSchema = z.enum([
  "conflicts",
  "checks_failed",
  "checks_waiting",
  "changes_requested",
  "behind",
  "review_required",
  "unresolved_threads",
  "checks_running",
  "draft",
  "blocked",
]);
export const blockerSchema = z.object({
  code: blockerCodeSchema,
  text: z.string(),
});
export type Blocker = z.infer<typeof blockerSchema>;

export interface BlockerInput {
  prState: "open" | "draft" | "closed" | "merged";
  mergeable: z.infer<typeof mergeableSchema>;
  mergeStateStatus: z.infer<typeof mergeStateStatusSchema>;
  reviewDecision: z.infer<typeof reviewDecisionSchema>;
  unresolvedThreads: number;
  checks: readonly Pick<Check, "name" | "status">[];
  mergeQueue: MergeQueue;
}

const READY_TO_MERGE: ReadonlySet<BlockerInput["mergeStateStatus"]> = new Set([
  "CLEAN",
  "HAS_HOOKS",
]);

export function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function buildBlockers(input: BlockerInput): Blocker[] {
  if (input.prState === "merged" || input.prState === "closed") return [];
  if (input.mergeQueue !== null) return [];
  if (READY_TO_MERGE.has(input.mergeStateStatus)) return [];

  const withStatus = (status: Check["status"]) =>
    input.checks.filter((check) => check.status === status);
  const failed = withStatus("failed").length;
  const running = withStatus("running").length;
  const waiting = withStatus("waiting");
  const candidates: [applies: boolean, blocker: Blocker][] = [
    [
      input.mergeable === "CONFLICTING" || input.mergeStateStatus === "DIRTY",
      { code: "conflicts", text: "Merge conflicts" },
    ],
    [failed > 0, { code: "checks_failed", text: `${countOf(failed, "check")} failed` }],
    [
      waiting.length > 0,
      {
        code: "checks_waiting",
        text: `${waiting.length === 1 ? waiting[0]!.name : countOf(waiting.length, "check")} waiting for you`,
      },
    ],
    [
      input.reviewDecision === "CHANGES_REQUESTED",
      { code: "changes_requested", text: "Changes requested" },
    ],
    [input.mergeStateStatus === "BEHIND", { code: "behind", text: "Branch out of date" }],
    [
      input.reviewDecision === "REVIEW_REQUIRED",
      { code: "review_required", text: "Review required" },
    ],
    [
      input.unresolvedThreads > 0,
      {
        code: "unresolved_threads",
        text: countOf(input.unresolvedThreads, "unresolved thread"),
      },
    ],
    [running > 0, { code: "checks_running", text: `${countOf(running, "check")} running` }],
    [input.prState === "draft", { code: "draft", text: "Draft" }],
  ];
  const blockers = candidates.flatMap(([applies, blocker]) => (applies ? [blocker] : []));
  if (blockers.length === 0 && input.mergeStateStatus === "BLOCKED") {
    return [{ code: "blocked", text: "Blocked by branch rules" }];
  }
  return blockers;
}
