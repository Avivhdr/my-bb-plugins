import { describe, expect, it } from "vitest";
import fixture from "../test/fixtures/review-queue.json";
import trackedFixture from "../test/fixtures/review-queue-tracked.json";
import { parseGithubRepo, parseReviewQueue, type QueueList, type QueuePr } from "./review-queue";

const NOW = Date.parse("2026-10-02T10:00:00Z");
const DAY = 24 * 3_600_000;

function prs(list: QueueList): QueuePr[] {
  return list.groups.flatMap((group) => group.prs);
}

function byNumber(list: QueueList, number: number): QueuePr {
  return prs(list).find((pr) => pr.number === number)!;
}

describe("parseGithubRepo", () => {
  it.each([
    ["https://github.com/acme/api", "acme/api"],
    ["https://github.com/acme/api.git", "acme/api"],
    ["https://token@github.com/acme/api.git", "acme/api"],
    ["git@github.com:acme/api.git", "acme/api"],
    ["ssh://git@github.com/acme/api.git", "acme/api"],
    ["git@github.com:Acme/API.git", "acme/api"],
    ["HTTPS://GitHub.com/Acme/API/", "acme/api"],
  ])("reads %s as %s", (remote, repo) => {
    expect(parseGithubRepo(remote)).toBe(repo);
  });

  it.each([
    "https://gitlab.com/acme/api.git",
    "git@bitbucket.org:acme/api.git",
    "https://github.com/acme",
    "not a url",
  ])("returns null for %s", (remote) => {
    expect(parseGithubRepo(remote)).toBeNull();
  });

  it("returns null for a null remote", () => {
    expect(parseGithubRepo(null)).toBeNull();
  });
});

describe("parseReviewQueue", () => {
  const queue = parseReviewQueue([fixture], [], NOW).requests;

  it("maps a node to a QueuePr", () => {
    expect(byNumber(queue, 12)).toEqual({
      repo: "acme/api",
      number: 12,
      title: "Add retries",
      author: "alice",
      createdAt: "2026-09-30T08:00:00Z",
      updatedAt: "2026-10-02T09:00:00Z",
      draft: false,
      ci: "passed",
      reviewDecision: "REVIEW_REQUIRED",
      headRefName: "alice/retries",
      headOid: "a12a12a12a12a12a12a12a12a12a12a12a12a12a",
      url: "https://github.com/acme/api/pull/12",
      state: "open",
      closedAt: null,
      activity: null,
    });
  });

  it.each([
    [12, "passed"],
    [7, "failed"],
    [15, "running"],
  ] as const)("maps the CI state of #%i to %s", (number, ci) => {
    expect(byNumber(queue, number).ci).toBe(ci);
  });

  it("maps a missing status rollup to no CI state", () => {
    expect(byNumber(queue, 3).ci).toBe("none");
  });

  it.each([
    [12, "REVIEW_REQUIRED"],
    [7, "CHANGES_REQUESTED"],
    [15, "APPROVED"],
  ] as const)("keeps the review decision of #%i", (number, decision) => {
    expect(byNumber(queue, number).reviewDecision).toBe(decision);
  });

  it("keeps a missing review decision as null", () => {
    expect(byNumber(queue, 3).reviewDecision).toBeNull();
  });

  it("marks drafts", () => {
    expect(byNumber(queue, 7).draft).toBe(true);
    expect(byNumber(queue, 12).draft).toBe(false);
  });

  it("maps a deleted author to null", () => {
    expect(byNumber(queue, 15).author).toBeNull();
  });

  it("orders groups by repo and PRs inside a group newest update first", () => {
    expect(queue.groups.map((group) => [group.repo, group.prs.map((pr) => pr.number)])).toEqual([
      ["acme/api", [15, 12]],
      ["acme/docs", [3]],
      ["acme/web", [7]],
    ]);
  });

  function withIssueCount(issueCount: number) {
    return {
      data: { ...fixture.data, reviewRequests: { ...fixture.data.reviewRequests, issueCount } },
    };
  }

  it("flags the list as truncated when GitHub reports more than 50", () => {
    expect(queue.truncated).toBe(false);
    expect(parseReviewQueue([withIssueCount(70)], [], NOW).requests.truncated).toBe(true);
  });

  it("flags 50 results as complete", () => {
    expect(parseReviewQueue([withIssueCount(50)], [], NOW).requests.truncated).toBe(false);
  });

  it("rejects a response without the viewer", () => {
    const { viewer: _, ...data } = fixture.data;

    expect(() => parseReviewQueue([{ data }], [], NOW)).toThrow();
  });

  it("rejects a response without the review requests search", () => {
    expect(() => parseReviewQueue([{ data: {} }], [], NOW)).toThrow();
  });
});

describe("parseReviewQueue with tracked PRs", () => {
  const refs = [
    { owner: "acme", repo: "api", number: 15 },
    { owner: "acme", repo: "web", number: 8 },
    { owner: "gone", repo: "repo", number: 1 },
    { owner: "acme", repo: "api", number: 99 },
    { owner: "acme", repo: "api", number: 12 },
  ];
  const fetched = parseReviewQueue([trackedFixture], refs, NOW);

  it("reads open tracked PRs with their head commit and recently merged ones with their merge time", () => {
    expect(
      fetched.tracked.map((pr) => [pr.repo, pr.number, pr.headOid, pr.state, pr.closedAt]),
    ).toEqual([
      ["acme/api", 15, "e15e15e15e15e15e15e15e15e15e15e15e15e15e", "open", null],
      ["acme/web", 8, "f08f08f08f08f08f08f08f08f08f08f08f08f08f", "merged", "2026-10-01T12:00:00Z"],
      ["acme/api", 12, "a12a12a12a12a12a12a12a12a12a12a12a12a12a", "open", null],
    ]);
  });

  it("reports missing repositories and missing PRs as gone", () => {
    expect(fetched.gone).toEqual([refs[2], refs[3]]);
  });

  it("reports a PR merged more than 7 days ago as gone", () => {
    const later = Date.parse("2026-10-01T12:00:00Z") + 7 * DAY + 1;

    expect(parseReviewQueue([trackedFixture], refs, later).gone).toEqual([
      refs[1],
      refs[2],
      refs[3],
    ]);
  });

  it("keeps a PR merged exactly 7 days ago", () => {
    const later = Date.parse("2026-10-01T12:00:00Z") + 7 * DAY;

    expect(parseReviewQueue([trackedFixture], refs, later).gone).toEqual([refs[2], refs[3]]);
  });

  it("keeps the review requests next to the tracked PRs", () => {
    expect(prs(fetched.requests).map((pr) => pr.number)).toEqual([12]);
  });

  it("reports a tracked PR that the response leaves out as gone", () => {
    expect(parseReviewQueue([fixture], [refs[0]!], NOW).gone).toEqual([refs[0]]);
  });

  it("reads the same PRs when the tracked PRs come in a separate batch response", () => {
    const { viewer, reviewRequests, ...trackedData } = trackedFixture.data;

    const batched = parseReviewQueue(
      [{ data: { viewer, reviewRequests } }, { data: { viewer, ...trackedData } }],
      refs,
      NOW,
    );

    expect(batched).toEqual(fetched);
  });
});

describe("parseReviewQueue activity on tracked PRs", () => {
  const ref = { owner: "acme", repo: "api", number: 15 };
  const trackedNode = trackedFixture.data.t0.pullRequest;
  const person = (login: string) => ({ __typename: "User", login });
  const bot = { __typename: "Bot", login: "github-actions" };

  function activityOf(nodes: { comments?: unknown[]; reviews?: unknown[]; requests?: unknown[] }) {
    const response = {
      data: {
        viewer: { login: "me" },
        reviewRequests: { issueCount: 0, nodes: [] },
        t0: {
          pullRequest: {
            ...trackedNode,
            comments: { nodes: nodes.comments ?? [] },
            reviews: { nodes: nodes.reviews ?? [] },
            timelineItems: { nodes: nodes.requests ?? [] },
          },
        },
      },
    };
    return parseReviewQueue([response], [ref], NOW).tracked[0]!.activity;
  }

  function review(
    author: unknown,
    body: string,
    submittedAt: string | null,
    comments: { id: string; createdAt: string; publishedAt: string | null }[] = [],
    id = "PRR_1",
  ) {
    return { id, submittedAt, body, author, comments: { nodes: comments } };
  }

  function prComment(id: string, createdAt: string, author: unknown) {
    return { id, createdAt, author };
  }

  function inline(id: string, createdAt: string, publishedAt: string | null = createdAt) {
    return { id, createdAt, publishedAt };
  }

  it("has no activity on review request rows", () => {
    expect(byNumber(parseReviewQueue([fixture], [], NOW).requests, 12).activity).toBeNull();
  });

  it("reports nothing when nobody posted", () => {
    expect(activityOf({})).toEqual({
      conversationComments: [],
      inlineComments: [],
      lastRequestedAt: null,
    });
  });

  it("keeps each PR comment from a person with its id", () => {
    const comments = [
      prComment("IC_1", "2026-10-07T08:00:00Z", person("alice")),
      prComment("IC_2", "2026-10-07T09:00:00Z", person("bob")),
    ];

    expect(activityOf({ comments })?.conversationComments).toEqual([
      { id: "IC_1", postedAt: "2026-10-07T08:00:00Z" },
      { id: "IC_2", postedAt: "2026-10-07T09:00:00Z" },
    ]);
  });

  it.each([
    ["a bot", prComment("IC_1", "2026-10-07T09:00:00Z", bot)],
    ["the viewer", prComment("IC_1", "2026-10-07T09:00:00Z", person("me"))],
    ["a deleted user", prComment("IC_1", "2026-10-07T09:00:00Z", null)],
  ])("ignores a PR comment from %s", (_, comment) => {
    expect(activityOf({ comments: [comment] })?.conversationComments).toEqual([]);
  });

  it("puts a reply review with no body in the inline comments only", () => {
    const reviews = [
      review(person("alice"), "", "2026-10-07T08:38:57Z", [
        inline("PRRC_1", "2026-10-07T08:38:57Z"),
      ]),
    ];

    expect(activityOf({ reviews })).toMatchObject({
      conversationComments: [],
      inlineComments: [{ id: "PRRC_1", postedAt: "2026-10-07T08:38:57Z" }],
    });
  });

  it("times an inline comment of a pending review at its publish time", () => {
    const reviews = [
      review(person("alice"), "", "2026-10-07T11:00:00Z", [
        inline("PRRC_1", "2026-10-07T09:00:00Z", "2026-10-07T11:00:00Z"),
      ]),
    ];

    expect(activityOf({ reviews })?.inlineComments).toEqual([
      { id: "PRRC_1", postedAt: "2026-10-07T11:00:00Z" },
    ]);
  });

  it("keeps a review body as a conversation comment with the review id", () => {
    const reviews = [
      review(person("alice"), "Fixed, please look again", "2026-10-07T08:38:57Z", [], "PRR_7"),
    ];

    expect(activityOf({ reviews })?.conversationComments).toEqual([
      { id: "PRR_7", postedAt: "2026-10-07T08:38:57Z" },
    ]);
  });

  it.each([
    ["an approval with no text", review(person("alice"), "", "2026-10-07T08:44:48Z")],
    [
      "a bot review",
      review(bot, "Looks fine", "2026-10-07T08:44:48Z", [inline("c", "2026-10-07T08:44:48Z")]),
    ],
    [
      "a viewer review",
      review(person("me"), "Nit", "2026-10-07T08:44:48Z", [inline("c", "2026-10-07T08:44:48Z")]),
    ],
    [
      "a pending review",
      review(person("alice"), "Draft", null, [inline("c", "2026-10-07T08:44:48Z")]),
    ],
  ])("ignores %s", (_, item) => {
    expect(activityOf({ reviews: [item] })).toMatchObject({
      conversationComments: [],
      inlineComments: [],
    });
  });

  it("takes the newest review request for the viewer", () => {
    const requests = [
      { createdAt: "2026-10-06T10:35:12Z", requestedReviewer: person("me") },
      { createdAt: "2026-10-07T08:50:27Z", requestedReviewer: person("me") },
    ];

    expect(activityOf({ requests })?.lastRequestedAt).toBe("2026-10-07T08:50:27Z");
  });

  it.each([
    ["a team", { createdAt: "2026-10-07T08:50:27Z", requestedReviewer: { __typename: "Team" } }],
    ["another user", { createdAt: "2026-10-07T08:50:27Z", requestedReviewer: person("alice") }],
    ["a deleted reviewer", { createdAt: "2026-10-07T08:50:27Z", requestedReviewer: null }],
  ])("ignores a review request for %s", (_, request) => {
    expect(activityOf({ requests: [request] })?.lastRequestedAt).toBeNull();
  });
});
