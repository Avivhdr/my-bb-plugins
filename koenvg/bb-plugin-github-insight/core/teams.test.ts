import { describe, expect, it } from "vitest";
import { parseTeamMembers, parseViewerTeams, teamMembersArgs } from "./teams";

describe("parseViewerTeams", () => {
  it("reads every page as org/slug teams, sorted", () => {
    const pages = [
      [{ slug: "ai-governance", name: "AI Governance", organization: { login: "collibra" } }],
      [{ slug: "core", name: "Core", organization: { login: "acme" } }],
    ];

    expect(parseViewerTeams(pages)).toEqual([
      { team: "acme/core", name: "Core" },
      { team: "collibra/ai-governance", name: "AI Governance" },
    ]);
  });
});

describe("parseTeamMembers", () => {
  it("reads every page as lowercase logins", () => {
    expect(parseTeamMembers([[{ login: "GBrari" }], [{ login: "koenvangeert" }]])).toEqual([
      "gbrari",
      "koenvangeert",
    ]);
  });
});

describe("teamMembersArgs", () => {
  it("reads every page of the team's members", () => {
    expect(teamMembersArgs("collibra/ai-governance")).toEqual([
      "api",
      "--paginate",
      "--slurp",
      "orgs/collibra/teams/ai-governance/members?per_page=100",
    ]);
  });

  it("rejects a team that is not org/slug", () => {
    expect(() => teamMembersArgs("collibra/../users")).toThrow();
  });
});
