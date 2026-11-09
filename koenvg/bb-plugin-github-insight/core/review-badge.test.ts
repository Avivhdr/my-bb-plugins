import { describe, expect, it } from "vitest";
import { reviewBadge } from "./review-badge";
import type {
  LinkedQueuePr,
  LinkedThread,
  QueueLayer,
  QueueSection,
  ReviewQueueView,
} from "./review-queue-view";

function pr(thread: LinkedThread | null = null, skipLabel: string | null = null): LinkedQueuePr {
  return { number: 1, thread, skipLabel } as LinkedQueuePr;
}

function prs(count: number): LinkedQueuePr[] {
  return Array.from({ length: count }, () => pr());
}

function thread(
  status: LinkedThread["status"],
  returned: LinkedThread["returned"] = null,
): LinkedThread {
  return { id: "thr", status, isReviewThread: true, returned };
}

function layer(name: string, members: LinkedQueuePr[], truncated = false): QueueLayer {
  return {
    name,
    prs: [{ repo: "acme/api", prs: members }],
    count: members.filter((member) => member.skipLabel === null).length,
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
    autoReviewOn: false,
    workingDay: null,
    ...overrides,
  };
}

const empty = { inProgress: 0, ready: 0, unseen: false, returned: false };

describe("reviewBadge", () => {
  it("shows nothing before a list loaded", () => {
    expect(reviewBadge(null)).toBeNull();
  });

  it("shows nothing when nothing waits and no agent came back", () => {
    expect(reviewBadge(view([layer("Direct", []), layer("Team", [])]))).toBeNull();
  });

  it("sums the layers and leaves out reviewed, merged, and ignored PRs", () => {
    const other = [{ repo: "acme/docs", prs: prs(3) }];
    const badge = reviewBadge(
      view([layer("Direct", prs(10)), layer("Team", prs(1))], {
        reviewed: other,
        merged: other,
        ignored: other,
      }),
    );

    expect(badge).toEqual({ ...empty, waiting: "11" });
  });

  it("adds a plus when a layer is truncated", () => {
    expect(reviewBadge(view([layer("Direct", prs(2)), layer("Team", prs(50), true)]))).toEqual({
      ...empty,
      waiting: "52+",
    });
  });

  it("passes the unseen and returned state through", () => {
    expect(
      reviewBadge(view([layer("Direct", prs(2))], { hasUnseen: true, hasReturned: true })),
    ).toEqual({ ...empty, waiting: "2", unseen: true, returned: true });
  });

  it("shows a returned agent without counts when nothing waits", () => {
    expect(reviewBadge(view([layer("Direct", [])], { hasReturned: true }))).toEqual({
      ...empty,
      waiting: null,
      returned: true,
    });
  });

  it("splits the waiting PRs into waiting, in progress, and ready", () => {
    const waiting = [
      pr(),
      pr(thread("error", "failed")),
      pr(thread("idle")),
      pr(thread("running")),
      pr(thread("needs_you", "needs_you")),
      pr(thread("idle", "finished")),
      pr(thread("idle", "finished")),
      pr(thread("running"), "DO NOT REVIEW"),
    ];
    const reviewed = [{ repo: "acme/docs", prs: [pr(thread("idle", "finished"))] }];

    expect(reviewBadge(view([layer("Direct", waiting)], { reviewed, hasReturned: true }))).toEqual({
      waiting: "3",
      inProgress: 2,
      ready: 2,
      unseen: false,
      returned: true,
    });
  });

  it("counts a finished review that Re-review replaces as waiting, not ready", () => {
    const outdated = {
      ...pr(thread("idle", "finished")),
      reReview: true,
    } as LinkedQueuePr;

    expect(
      reviewBadge(view([layer("Direct", [outdated, pr(thread("idle", "finished"))])])),
    ).toEqual({ ...empty, waiting: "1", ready: 1 });
  });

  it("leaves the waiting count out when every PR has a review under way or ready", () => {
    const badge = reviewBadge(
      view([layer("Direct", [pr(thread("running")), pr(thread("idle", "finished"))])]),
    );

    expect(badge).toEqual({ ...empty, waiting: null, inProgress: 1, ready: 1 });
  });
});
