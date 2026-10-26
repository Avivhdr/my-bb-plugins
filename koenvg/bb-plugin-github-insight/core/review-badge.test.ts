import { describe, expect, it } from "vitest";
import { reviewBadge } from "./review-badge";
import type { LinkedQueuePr, QueueLayer, QueueSection, ReviewQueueView } from "./review-queue-view";

function prs(count: number): LinkedQueuePr[] {
  return Array.from({ length: count }, (_, index) => ({ number: index + 1 }) as LinkedQueuePr);
}

function layer(name: string, count: number, truncated = false): QueueLayer {
  return {
    name,
    prs: [{ repo: "acme/api", prs: prs(count) }],
    count,
    truncated,
    hiddenRepos: [],
    teammates: null,
  };
}

function view(layers: QueueLayer[], overrides: Partial<ReviewQueueView> = {}): ReviewQueueView {
  const section: QueueSection = [];
  return {
    layers,
    reviewed: section,
    merged: section,
    ignored: section,
    hiddenEverywhere: [],
    teammatesTeam: null,
    teammatesError: null,
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
    expect(reviewBadge(view([layer("Direct", 0), layer("Team", 0)]))).toBeNull();
  });

  it("sums the layer counts and leaves out reviewed, merged, and ignored PRs", () => {
    const other = [{ repo: "acme/docs", prs: prs(3) }];
    const badge = reviewBadge(
      view([layer("Direct", 10), layer("Team", 1)], {
        reviewed: other,
        merged: other,
        ignored: other,
      }),
    );

    expect(badge).toEqual({ count: "11", unseen: false, returned: false });
  });

  it("adds a plus when a layer is truncated", () => {
    expect(reviewBadge(view([layer("Direct", 2), layer("Team", 50, true)]))).toEqual({
      count: "52+",
      unseen: false,
      returned: false,
    });
  });

  it("passes the unseen and returned state through", () => {
    expect(reviewBadge(view([layer("Direct", 2)], { hasUnseen: true, hasReturned: true }))).toEqual(
      { count: "2", unseen: true, returned: true },
    );
  });

  it("shows a returned agent without a count when nothing waits", () => {
    expect(reviewBadge(view([layer("Direct", 0)], { hasReturned: true }))).toEqual({
      count: null,
      unseen: false,
      returned: true,
    });
  });
});
