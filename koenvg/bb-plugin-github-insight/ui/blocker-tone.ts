import type { Blocker } from "../core/blockers";

const TONE: Record<Blocker["code"], string> = {
  conflicts: "text-destructive",
  checks_failed: "text-destructive",
  checks_waiting: "text-attention",
  changes_requested: "text-destructive",
  behind: "text-attention",
  review_required: "text-attention",
  unresolved_threads: "text-attention",
  checks_running: "text-attention",
  blocked: "text-attention",
  draft: "text-muted-foreground",
};

export function blockerTone(code: Blocker["code"]): string {
  return TONE[code];
}
