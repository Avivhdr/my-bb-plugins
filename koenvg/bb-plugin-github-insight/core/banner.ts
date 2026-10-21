import { countOf, type Blocker } from "./blockers";
import type { PrInsight } from "./overview";

const CHECK_COUNT_CODES: ReadonlySet<Blocker["code"]> = new Set([
  "checks_failed",
  "checks_waiting",
  "checks_running",
]);

export function bannerParts(insight: PrInsight): string[] {
  const { pr, blockers, reviewers } = insight;
  if (pr.state === "merged" || pr.state === "closed" || blockers.length === 0) return [];

  const textOf = (code: Blocker["code"]) => blockers.find((blocker) => blocker.code === code)?.text;
  const pendingReviews = reviewers.filter((reviewer) => reviewer.state === "pending").length;
  const topOther = blockers.find(
    (blocker) =>
      !CHECK_COUNT_CODES.has(blocker.code) &&
      !(blocker.code === "review_required" && pendingReviews > 0),
  );

  return [
    textOf("checks_failed"),
    textOf("checks_waiting"),
    textOf("checks_running"),
    pendingReviews > 0 ? `${countOf(pendingReviews, "review")} pending` : undefined,
    topOther?.text,
  ].filter((part): part is string => part !== undefined);
}
