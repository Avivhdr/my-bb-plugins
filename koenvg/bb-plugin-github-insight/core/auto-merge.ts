import { z } from "zod";
import type { Blocker } from "./blockers";
import { mergeMethodSchema, type MergeMethod } from "./merge-action";

export const autoMergeActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("enable"), method: mergeMethodSchema }),
  z.object({ kind: z.literal("disable"), method: mergeMethodSchema }),
]);
export type AutoMergeAction = z.infer<typeof autoMergeActionSchema>;

export const AUTO_MERGE_METHOD_LABEL: Record<MergeMethod, string> = {
  MERGE: "merge",
  SQUASH: "squash",
  REBASE: "rebase",
};

const WAITING_BLOCKERS: ReadonlySet<Blocker["code"]> = new Set([
  "checks_running",
  "checks_waiting",
  "review_required",
]);

export interface AutoMergeActionInput {
  prState: "open" | "draft" | "closed" | "merged";
  blockers: readonly Blocker[];
  isMergeQueueEnabled: boolean;
  autoMergeAllowed: boolean;
  autoMergeMethod: MergeMethod | null;
  defaultMethod: MergeMethod;
  allowedMethods: Readonly<Record<MergeMethod, boolean>>;
}

export function buildAutoMergeAction(input: AutoMergeActionInput): AutoMergeAction {
  const live = input.prState === "open" || input.prState === "draft";
  if (live && input.autoMergeMethod !== null) {
    return { kind: "disable", method: input.autoMergeMethod };
  }
  if (input.prState !== "open") return { kind: "none" };
  if (input.isMergeQueueEnabled || !input.autoMergeAllowed) return { kind: "none" };
  if (!input.allowedMethods[input.defaultMethod]) return { kind: "none" };
  if (input.blockers.length === 0) return { kind: "none" };
  if (!input.blockers.every((blocker) => WAITING_BLOCKERS.has(blocker.code))) {
    return { kind: "none" };
  }
  return { kind: "enable", method: input.defaultMethod };
}
