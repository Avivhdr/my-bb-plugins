import { z } from "zod";
import { hasText } from "./review-drafts";

export const reviewEventSchema = z.enum(["COMMENT", "APPROVE", "REQUEST_CHANGES"]);
export type ReviewEvent = z.infer<typeof reviewEventSchema>;

export const prStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);
export type PrState = z.infer<typeof prStateSchema>;

export interface SubmitRulesInput {
  viewerIsAuthor: boolean;
  state: PrState;
  body: string;
  commentCount: number;
}

export interface VerdictRule {
  event: ReviewEvent;
  disabledReason: string | null;
}

const STATE_REASONS: Record<Exclude<PrState, "OPEN">, string> = {
  MERGED: "Pull request is merged",
  CLOSED: "Pull request is closed",
};

export function closedReason(state: PrState): string | null {
  return state === "OPEN" ? null : STATE_REASONS[state];
}

export function submitRules(input: SubmitRulesInput): VerdictRule[] {
  const events: ReviewEvent[] = input.viewerIsAuthor
    ? ["COMMENT"]
    : ["COMMENT", "APPROVE", "REQUEST_CHANGES"];
  return events.map((event) => ({ event, disabledReason: disabledReason(event, input) }));
}

function disabledReason(
  event: ReviewEvent,
  { state, body, commentCount }: SubmitRulesInput,
): string | null {
  if (state !== "OPEN") return STATE_REASONS[state];
  const hasBody = hasText(body);
  if (event === "REQUEST_CHANGES" && !hasBody) return "Add a summary to request changes";
  if (event === "COMMENT" && !hasBody && commentCount === 0) return "Add a summary or a comment";
  return null;
}
