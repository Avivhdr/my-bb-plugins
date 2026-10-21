import { describe, expect, it } from "vitest";
import {
  parseTeamPrPage,
  parseViewerTeams,
  scanTeamPrs,
  TEAM_SCAN_MAX_PAGES,
  type RepoSince,
} from "./team-prs";

const TEAMS = new Set(["collibra/ai-governance"]);

function user(login: string) {
  return { requestedReviewer: { __typename: "User", login } };
}

function team(combinedSlug: string) {
  return { requestedReviewer: { __typename: "Team", combinedSlug } };
}

function pr(number: number, requests: unknown[], updatedAt = "2026-10-20T10:00:00Z") {
  return {
    number,
    updatedAt,
    repository: { nameWithOwner: "Collibra/Frontend" },
    timelineItems: { nodes: requests },
  };
}

function page(nodes: unknown[], endCursor: string | null = null, login = "KoenVanGeert") {
  return {
    data: {
      viewer: { login },
      search: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes },
    },
  };
}

describe("parseViewerTeams", () => {
  it("reads each team of every page as its lowercase org/slug", () => {
    const response = [
      [{ slug: "AI-Governance", organization: { login: "Collibra" } }],
      [{ slug: "engineering", organization: { login: "collibra" } }],
    ];

    expect(parseViewerTeams(response)).toEqual(
      new Set(["collibra/ai-governance", "collibra/engineering"]),
    );
  });
});

describe("parseTeamPrPage", () => {
  it("keeps a PR once requested from a team of the viewer, matching the slug in any case", () => {
    const parsed = parseTeamPrPage(page([pr(7, [team("Collibra/AI-Governance")])]), TEAMS);

    expect(parsed.refs).toEqual([{ owner: "collibra", repo: "frontend", number: 7 }]);
  });

  it("keeps a PR once requested from the viewer in person", () => {
    expect(parseTeamPrPage(page([pr(7, [user("koenvangeert")])]), TEAMS).refs).toHaveLength(1);
  });

  it("leaves out PRs requested only from other people, other teams, or bots", () => {
    const parsed = parseTeamPrPage(
      page([
        pr(1, [user("alice"), team("collibra/engineering-other")]),
        pr(2, [{ requestedReviewer: { __typename: "Bot", login: "koenvangeert" } }]),
        pr(3, [{ requestedReviewer: null }, {}]),
        pr(4, []),
        null,
      ]),
      TEAMS,
    );

    expect(parsed.refs).toEqual([]);
  });

  it("gives the cursor of the next page and the update time of the last PR", () => {
    const parsed = parseTeamPrPage(
      page([pr(1, [], "2026-10-15T00:00:00Z"), pr(2, [], "2026-10-16T00:00:00Z")], "c1"),
      TEAMS,
    );

    expect(parsed).toMatchObject({ after: "c1", lastUpdatedAt: "2026-10-16T00:00:00Z" });
  });

  it("gives no cursor on the last page", () => {
    expect(parseTeamPrPage(page([]), TEAMS)).toMatchObject({ after: null, lastUpdatedAt: null });
  });
});

describe("scanTeamPrs", () => {
  const STARTED_AT = "2026-10-21T09:00:00.000Z";
  const teams = [[{ slug: "ai-governance", organization: { login: "collibra" } }]];

  function sourceOf(pages: (request: RepoSince & { after: string | null }) => unknown) {
    const requests: (RepoSince & { after: string | null })[] = [];
    return {
      requests,
      source: {
        fetchViewerTeams: async () => teams,
        fetchPage: async (request: RepoSince & { after: string | null }) => {
          requests.push(request);
          return pages(request);
        },
      },
    };
  }

  it("follows the cursor through every page and marks the repository scanned through the start", async () => {
    const { source, requests } = sourceOf(({ after }) =>
      after === null
        ? page([pr(1, [team("collibra/ai-governance")])], "c1")
        : page([pr(2, [user("someone")]), pr(3, [team("collibra/ai-governance")])]),
    );

    const scan = await scanTeamPrs(source, {
      repos: [{ repo: "collibra/frontend", since: "2026-10-14T09:00:00.000Z" }],
      startedAt: STARTED_AT,
    });

    expect(requests.map(({ after }) => after)).toEqual([null, "c1"]);
    expect(scan).toEqual({
      refs: [
        { owner: "collibra", repo: "frontend", number: 1 },
        { owner: "collibra", repo: "frontend", number: 3 },
      ],
      scannedThrough: { "collibra/frontend": STARTED_AT },
    });
  });

  it("stops after the page cap and marks the repository scanned through its last PR", async () => {
    let next = 0;
    const { source, requests } = sourceOf(() => {
      next += 1;
      return page([pr(next, [], `2026-10-15T00:00:${String(next).padStart(2, "0")}Z`)], `c${next}`);
    });

    const scan = await scanTeamPrs(source, {
      repos: [{ repo: "collibra/frontend", since: "2026-10-14T09:00:00.000Z" }],
      startedAt: STARTED_AT,
    });

    expect(requests).toHaveLength(TEAM_SCAN_MAX_PAGES);
    expect(scan.scannedThrough).toEqual({ "collibra/frontend": "2026-10-15T00:00:10Z" });
  });

  it("rejects when a page fails, so nothing counts as scanned", async () => {
    const { source } = sourceOf(({ repo }) => {
      if (repo === "collibra/dgc-core") throw new Error("gh: HTTP 502");
      return page([]);
    });

    await expect(
      scanTeamPrs(source, {
        repos: [
          { repo: "collibra/frontend", since: STARTED_AT },
          { repo: "collibra/dgc-core", since: STARTED_AT },
        ],
        startedAt: STARTED_AT,
      }),
    ).rejects.toThrow("gh: HTTP 502");
  });
});
