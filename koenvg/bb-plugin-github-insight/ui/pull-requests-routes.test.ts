import { describe, expect, it } from "vitest";
import {
  parsePullRequestsRoute,
  pullRequestsRouteToSubPath,
  type PullRequestsRoute,
} from "./pull-requests-routes";

describe("Pull Requests routes", () => {
  it.each<[string, PullRequestsRoute]>([
    ["", { kind: "list", selected: null }],
    ["pr/acme/api/15", { kind: "list", selected: { owner: "acme", repo: "api", number: 15 } }],
    ["review/acme/api/15", { kind: "review", repo: "acme/api", number: 15 }],
    [
      "pr/acme/my%20repo/3",
      { kind: "list", selected: { owner: "acme", repo: "my repo", number: 3 } },
    ],
    ["activity", { kind: "list", tab: "activity", selected: null }],
    [
      "activity/pr/acme/api/15/inline/PRRC_1",
      {
        kind: "list",
        tab: "activity",
        selected: { owner: "acme", repo: "api", number: 15 },
        focus: { kind: "inline", commentId: "PRRC_1" },
      },
    ],
    [
      "pr/acme/api/15/conversation/IC_kw%2F1",
      {
        kind: "list",
        selected: { owner: "acme", repo: "api", number: 15 },
        focus: { kind: "conversation", commentId: "IC_kw/1" },
      },
    ],
  ])("round-trips %j", (subPath, route) => {
    expect(parsePullRequestsRoute(subPath)).toEqual(route);
    expect(pullRequestsRouteToSubPath(route)).toBe(subPath);
  });

  it.each(["pr/acme/api", "pr/acme/api/0", "pr/acme/api/x", "pr/acme/api/15/extra", "other/a/b/1"])(
    "falls back to the plain list for %j",
    (subPath) => {
      expect(parsePullRequestsRoute(subPath)).toEqual({ kind: "list", selected: null });
    },
  );
});
