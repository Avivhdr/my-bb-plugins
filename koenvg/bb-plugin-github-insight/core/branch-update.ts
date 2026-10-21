import type { z } from "zod";
import type { mergeableSchema, mergeStateStatusSchema } from "./blockers";
import type { MergeQueue } from "./merge-queue";

export interface BranchUpdateInput {
  prState: "open" | "draft" | "closed" | "merged";
  mergeable: z.infer<typeof mergeableSchema>;
  mergeStateStatus: z.infer<typeof mergeStateStatusSchema>;
  mergeQueue: MergeQueue;
}

export function canUpdateBranch(input: BranchUpdateInput): boolean {
  return (
    (input.prState === "open" || input.prState === "draft") &&
    input.mergeStateStatus === "BEHIND" &&
    input.mergeable !== "CONFLICTING" &&
    input.mergeQueue === null
  );
}
