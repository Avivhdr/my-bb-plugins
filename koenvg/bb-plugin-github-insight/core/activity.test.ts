import { describe, expect, it } from "vitest";
import {
  classifyPr,
  mentions,
  parseActivityDetails,
  parseNotifications,
  snippetOf,
  type ActivityPrDetail,
} from "./activity";

const SINCE = Date.parse("2026-10-20T00:00:00Z");
const ctx = { me: "me", teams: ["acme/core"], since: SINCE };
const person = (login: string) => ({ __typename: "User", login, avatarUrl: `https://a/${login}` });
const bot = { __typename: "Bot", login: "github-actions" };

type Author = { __typename?: string; login: string; avatarUrl?: string } | null;

let next = 0;
function comment(author: Author, body: string, at = "2026-10-21T10:00:00Z") {
  next += 1;
  return { id: `C${next}`, body, createdAt: at, url: `https://c/${next}`, author };
}
function review(author: Author, state: string, body = "", at = "2026-10-21T10:00:00Z") {
  next += 1;
  return { id: `R${next}`, body, state, submittedAt: at, url: `https://r/${next}`, author };
}

function pr(overrides: Partial<ActivityPrDetail> = {}): ActivityPrDetail {
  return {
    number: 7,
    title: "Add retries",
    url: "https://github.com/acme/api/pull/7",
    state: "OPEN",
    author: { login: "alice" },
    repository: { nameWithOwner: "acme/api" },
    comments: { nodes: [] },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
    ...overrides,
  } as ActivityPrDetail;
}

function kinds(detail: ActivityPrDetail) {
  return classifyPr(detail, ctx).map((item) => [item.kind, item.actor]);
}

describe("parseNotifications", () => {
  it("keeps pull requests with their notification state", () => {
    const pages = [
      [
        {
          id: "11",
          unread: false,
          reason: "mention",
          updated_at: "2026-10-21T10:00:00Z",
          last_read_at: "2026-10-21T11:00:00Z",
          subject: { type: "PullRequest", url: "https://api.github.com/repos/acme/api/pulls/7" },
        },
      ],
      [
        {
          id: "12",
          unread: true,
          reason: "subscribed",
          updated_at: "2026-10-21T10:00:00Z",
          last_read_at: null,
          subject: { type: "Issue", url: "https://api.github.com/repos/acme/api/issues/8" },
        },
      ],
    ];

    expect(parseNotifications(pages)).toEqual([
      {
        threadId: "11",
        ref: { owner: "acme", repo: "api", number: 7 },
        unread: false,
        updatedAt: "2026-10-21T10:00:00Z",
        lastReadAt: "2026-10-21T11:00:00Z",
      },
    ]);
  });
});

describe("parseActivityDetails", () => {
  it("reads the viewer and each PR at its alias, null for a missing one", () => {
    const refs = [
      { owner: "acme", repo: "api", number: 7 },
      { owner: "acme", repo: "gone", number: 1 },
    ];
    const parsed = parseActivityDetails(
      [{ data: { viewer: { login: "me" }, a0: { pullRequest: pr() }, a1: null } }],
      refs,
    );

    expect(parsed.viewer).toBe("me");
    expect(parsed.prs.map((detail) => detail?.number ?? null)).toEqual([7, null]);
  });
});

describe("classifyPr", () => {
  it("counts a mention of you or your team, but not inside a quote", () => {
    const detail = pr({
      comments: {
        nodes: [
          comment(person("bob"), "@me can you look?"),
          comment(person("carol"), "cc @acme/core"),
          comment(person("dan"), "> @me said this\nagreed"),
        ],
      },
    });

    expect(classifyPr(detail, ctx).map((item) => [item.kind, item.team])).toEqual([
      ["mention", null],
      ["team_mention", "acme/core"],
    ]);
  });

  it("counts a reply in an inline thread you wrote in, and places it inline", () => {
    const detail = pr({
      reviewThreads: {
        nodes: [
          {
            comments: {
              nodes: [
                comment(person("me"), "Why?", "2026-10-21T09:00:00Z"),
                comment(person("bob"), "Because", "2026-10-21T10:00:00Z"),
              ],
            },
          },
        ],
      },
    });

    expect(classifyPr(detail, ctx).map((item) => [item.kind, item.actor, item.place])).toEqual([
      ["reply", "bob", "inline"],
    ]);
  });

  it("counts comments and reviews with text on your PR, not bare approvals", () => {
    const detail = pr({
      author: { login: "Me" },
      comments: { nodes: [comment(person("bob"), "Looks odd")] },
      reviews: {
        nodes: [
          review(person("bob"), "APPROVED"),
          review(person("carol"), "APPROVED", "Ship it"),
          review(person("dan"), "CHANGES_REQUESTED"),
          review(person("erin"), "COMMENTED"),
        ],
      },
    });

    expect(kinds(detail).sort()).toEqual([
      ["approved", "carol"],
      ["changes_requested", "dan"],
      ["comment", "bob"],
    ]);
    expect(classifyPr(detail, ctx).find((item) => item.actor === "dan")?.snippet).toBe(
      "Requested changes",
    );
  });

  it("counts someone else's PR only after you took part, and not comments to others", () => {
    const detail = pr({
      comments: {
        nodes: [
          comment(person("bob"), "Before you", "2026-10-21T08:00:00Z"),
          comment(person("me"), "My question", "2026-10-21T09:00:00Z"),
          comment(person("bob"), "Answer", "2026-10-21T10:00:00Z"),
          comment(person("bob"), "@carol what do you think?", "2026-10-21T11:00:00Z"),
        ],
      },
    });

    expect(kinds(detail)).toEqual([["comment", "bob"]]);
  });

  it("leaves out bots, your own activity, and activity before the window", () => {
    const detail = pr({
      author: { login: "me" },
      comments: {
        nodes: [
          comment(bot, "Coverage"),
          comment(person("renovate[bot]"), "Update"),
          comment(person("me"), "Note to self"),
          comment(person("bob"), "Old", "2026-10-19T10:00:00Z"),
        ],
      },
    });

    expect(kinds(detail)).toEqual([]);
  });

  it("orders items newest first and keeps the avatar", () => {
    const detail = pr({
      author: { login: "me" },
      comments: {
        nodes: [
          comment(person("bob"), "First", "2026-10-21T09:00:00Z"),
          comment(person("carol"), "Second", "2026-10-21T10:00:00Z"),
        ],
      },
    });

    const items = classifyPr(detail, ctx);
    expect(items.map((item) => item.actor)).toEqual(["carol", "bob"]);
    expect(items[0]).toMatchObject({
      repo: "acme/api",
      number: 7,
      actorAvatarUrl: "https://a/carol",
      place: "conversation",
    });
  });
});

describe("mentions", () => {
  it.each([
    ["@me", true],
    ["hi @ME!", true],
    ["@meow", false],
    ["mail@me", false],
    ["@org/me", false],
  ])("%s mentions me: %s", (text, expected) => {
    expect(mentions(text, "me")).toBe(expected);
  });
});

describe("snippetOf", () => {
  it("drops quotes, HTML comments, and tags, and collapses spaces", () => {
    expect(snippetOf("> quoted\n<!-- hidden --> Hello   <b>world</b>\n![x](y)")).toBe(
      "Hello world [image]",
    );
  });

  it("shows the quote when a comment is only a quote", () => {
    expect(snippetOf("> just this")).toBe("just this");
  });

  it("cuts long text", () => {
    expect(snippetOf("a".repeat(300))).toHaveLength(201);
  });
});
