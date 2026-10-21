import { describe, expect, it } from "vitest";
import timelines from "../test/fixtures/pr-timelines.json";
import { groupTimeline, mergeEvents, parseTimelinePage, type TimelineEvent } from "./timeline";

const keepMedia = (markdown: string) => markdown;

const merged = parseTimelinePage(timelines["cli-14578"], keepMedia);
const reopened = parseTimelinePage(timelines["cli-13390"], keepMedia);
const commitRun = parseTimelinePage(timelines["cli-14507"], keepMedia);

function kinds(events: readonly { kind: string }[]) {
  return events.map(({ kind }) => kind);
}

describe("parseTimelinePage", () => {
  it("reads the PR fields that the composer needs", () => {
    expect(merged).toMatchObject({
      prNodeId: expect.stringMatching(/^PR_/),
      locked: false,
      viewerCanUpdate: false,
      olderCursor: null,
    });
  });

  it("reads the PR description with its author and time", () => {
    expect(reopened.description).toEqual({
      body: expect.any(String),
      author: "maxbeizer",
      at: "2026-05-09T18:54:34Z",
    });
    expect(reopened.description.body.length).toBeGreaterThan(0);
  });

  it("reads an empty description as an empty body", () => {
    const page = structuredClone(timelines["cli-13390"]);
    page.data.repository.pullRequest.body = "";

    expect(parseTimelinePage(page, keepMedia).description.body).toBe("");
  });

  it("keeps the event order of GitHub", () => {
    expect(kinds(merged.events)).toEqual([
      "commit",
      "review",
      "comment",
      "commit",
      "commit",
      "review",
      "commit",
      "ready_for_review",
      "comment",
      "commit",
      "comment",
      "comment",
      "review",
      "commit",
      "comment",
      "commit",
      "merged",
    ]);
  });

  it("drops the closed event that GitHub adds to a merge", () => {
    expect(kinds(merged.events)).not.toContain("closed");
  });

  it("reads a comment", () => {
    expect(merged.events[2]).toEqual({
      kind: "comment",
      id: expect.any(String),
      actor: "BagToad",
      at: "2026-10-02T19:08:19Z",
      body: expect.any(String),
      url: expect.stringContaining("#issuecomment-"),
    });
  });

  it("reads a review with a body and its inline comment ids", () => {
    const review = merged.events[1] as Extract<TimelineEvent, { kind: "review" }>;

    expect(review).toMatchObject({
      kind: "review",
      actor: "copilot-pull-request-reviewer",
      state: "commented",
      at: "2026-10-02T16:20:58Z",
      inlineCount: 3,
    });
    expect(review.body.length).toBeGreaterThan(0);
    expect(review.inlineCommentIds).toHaveLength(3);
  });

  it("reads an approval without a body", () => {
    expect(merged.events[12]).toMatchObject({
      kind: "review",
      actor: "BagToad",
      state: "approved",
      body: "",
      inlineCount: 0,
      inlineCommentIds: [],
    });
  });

  it("reads a commit with its short hash, headline, and author", () => {
    expect(merged.events[0]).toEqual({
      kind: "commit",
      id: expect.any(String),
      actor: "williammartin",
      at: "2026-10-02T16:14:56Z",
      oid: "e15e40d099bb09c62c4bc549a0d58397917efb45",
      headline: "Replace extension browse with Bubble Tea",
    });
  });

  it("reads lifecycle events with their actor", () => {
    expect(merged.events[7]).toMatchObject({ kind: "ready_for_review", actor: "williammartin" });
    expect(merged.events.at(-1)).toMatchObject({ kind: "merged", actor: "williammartin" });
    expect(kinds(reopened.events)).toEqual([
      "commit",
      "commit",
      "comment",
      "closed",
      "reopened",
      "comment",
    ]);
  });

  it("keeps PR comments and review texts from other people as posted comments", () => {
    expect(merged.othersComments).toEqual([
      { id: "IC_kwDODKw3uc8AAAABYzeJXQ", postedAt: "2026-10-02T19:08:19Z" },
      { id: "IC_kwDODKw3uc8AAAABZwikEw", postedAt: "2026-10-06T19:12:00Z" },
      { id: "IC_kwDODKw3uc8AAAABaFQoVw", postedAt: "2026-10-07T19:31:48Z" },
    ]);
  });

  it("keeps a review text from another person with the review id", () => {
    const page = structuredClone(timelines["cli-14578"]);
    const approval = page.data.repository.pullRequest.timelineItems.nodes.find(
      (node) => node.id === "PRR_kwDODKw3uc8AAAABRK-09w",
    ) as { body: string };
    approval.body = "Looks good";

    expect(parseTimelinePage(page, keepMedia).othersComments).toContainEqual({
      id: "PRR_kwDODKw3uc8AAAABRK-09w",
      postedAt: "2026-10-07T19:31:56Z",
    });
  });

  function nodeOf(page: (typeof timelines)["cli-14578"], id: string) {
    return page.data.repository.pullRequest.timelineItems.nodes.find(
      (node) => node.id === id,
    ) as Record<string, unknown>;
  }

  it.each([
    ["a deleted user", { author: null }],
    ["a pending review", { state: "PENDING", submittedAt: null }],
  ])("keeps no review text from %s", (_, change) => {
    const page = structuredClone(timelines["cli-14578"]);
    Object.assign(nodeOf(page, "PRR_kwDODKw3uc8AAAABRK-09w"), { body: "Looks good", ...change });

    expect(parseTimelinePage(page, keepMedia).othersComments).not.toContainEqual(
      expect.objectContaining({ id: "PRR_kwDODKw3uc8AAAABRK-09w" }),
    );
  });

  it("keeps no PR comment from a deleted user", () => {
    const page = structuredClone(timelines["cli-14578"]);
    nodeOf(page, "IC_kwDODKw3uc8AAAABYzeJXQ").author = null;

    expect(parseTimelinePage(page, keepMedia).othersComments).not.toContainEqual(
      expect.objectContaining({ id: "IC_kwDODKw3uc8AAAABYzeJXQ" }),
    );
  });

  it("returns the cursor of older events when GitHub has more", () => {
    const page = structuredClone(timelines["cli-14578"]);
    page.data.repository.pullRequest.timelineItems.pageInfo = {
      hasPreviousPage: true,
      startCursor: "Y3Vy",
    };

    expect(parseTimelinePage(page, keepMedia).olderCursor).toBe("Y3Vy");
  });

  it("uses the commit author name when the author has no GitHub user", () => {
    const page = structuredClone(timelines["cli-14578"]);
    const commit = page.data.repository.pullRequest.timelineItems.nodes[0] as {
      commit: { author: { name: string; user: { login: string } | null } };
    };
    commit.commit.author.user = null;

    expect(parseTimelinePage(page, keepMedia).events[0]).toMatchObject({ actor: "William Martin" });
  });
});

describe("groupTimeline", () => {
  it("groups commits next to each other into one entry", () => {
    const grouped = groupTimeline(commitRun.events);

    const group = grouped.find((entry) => entry.kind === "commits");
    expect(group).toMatchObject({ kind: "commits" });
    expect(group?.kind === "commits" && group.commits).toHaveLength(6);
  });

  it("splits commits that another event separates", () => {
    expect(kinds(groupTimeline(merged.events)).slice(0, 7)).toEqual([
      "commits",
      "review",
      "comment",
      "commits",
      "review",
      "commits",
      "ready_for_review",
    ]);
  });

  it("dates a commit group by its last commit", () => {
    const group = groupTimeline(merged.events)[3];

    expect(group).toMatchObject({ kind: "commits", at: "2026-10-06T15:11:01Z" });
  });
});

describe("mergeEvents", () => {
  const event = (id: string, body = id): TimelineEvent => ({
    kind: "comment",
    id,
    actor: "alice",
    at: "2026-10-01T10:00:00Z",
    body,
    url: "",
  });

  it("keeps the earlier events first and adds the new ones after", () => {
    expect(
      mergeEvents([event("a"), event("b")], [event("b"), event("c")]).map(({ id }) => id),
    ).toEqual(["a", "b", "c"]);
  });

  it("takes the later read of an event that both lists hold", () => {
    expect(mergeEvents([event("a", "old")], [event("a", "edited")])).toEqual([
      event("a", "edited"),
    ]);
  });
});
