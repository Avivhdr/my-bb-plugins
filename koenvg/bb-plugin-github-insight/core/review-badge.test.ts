import { describe, expect, it } from "vitest";
import { reviewBadge } from "./review-badge";
import type { LinkedQueuePr, QueueSection, ReviewQueueView } from "./review-queue-view";

function prs(count: number): LinkedQueuePr[] {
  return Array.from({ length: count }, (_, index) => ({ number: index + 1 }) as LinkedQueuePr);
}

function view(
  needsReview: QueueSection,
  overrides: Partial<ReviewQueueView> = {},
): ReviewQueueView {
  return {
    needsReview,
    reviewed: [],
    truncated: false,
    loadedAt: 1,
    hasUnseen: false,
    hasReturned: false,
    ...overrides,
  };
}

describe("reviewBadge", () => {
  it("shows nothing before a list loaded", () => {
    expect(reviewBadge(null)).toBeNull();
  });

  it("shows nothing when nothing waits and no agent came back", () => {
    expect(reviewBadge(view([]))).toBeNull();
  });

  it("sums needs-review PRs across repositories and ignores reviewed PRs", () => {
    const badge = reviewBadge(
      view(
        [
          { repo: "acme/api", prs: prs(10) },
          { repo: "acme/web", prs: prs(1) },
        ],
        { reviewed: [{ repo: "acme/docs", prs: prs(3) }] },
      ),
    );

    expect(badge).toEqual({ count: "11", unseen: false, returned: false });
  });

  it("shows 50+ for a truncated list", () => {
    expect(reviewBadge(view([{ repo: "acme/api", prs: prs(50) }], { truncated: true }))).toEqual({
      count: "50+",
      unseen: false,
      returned: false,
    });
  });

  it("passes the unseen and returned state through", () => {
    expect(
      reviewBadge(
        view([{ repo: "acme/api", prs: prs(2) }], { hasUnseen: true, hasReturned: true }),
      ),
    ).toEqual({ count: "2", unseen: true, returned: true });
  });

  it("shows a returned agent without a count when nothing waits", () => {
    expect(reviewBadge(view([], { hasReturned: true }))).toEqual({
      count: null,
      unseen: false,
      returned: true,
    });
  });
});
