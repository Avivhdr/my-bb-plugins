import { z } from "zod";

const TEAM = /^[\w.-]+\/[\w.-]+$/;

export const teamSchema = z.string().regex(TEAM);

const viewerTeamsSchema = z.array(
  z.array(
    z.object({ slug: z.string(), name: z.string(), organization: z.object({ login: z.string() }) }),
  ),
);

const teamMembersSchema = z.array(z.array(z.object({ login: z.string() })));

export interface ViewerTeam {
  /** `org/slug` */
  team: string;
  name: string;
}

/** Reads the pages of `gh api --paginate --slurp user/teams`, sorted by `org/slug`. */
export function parseViewerTeams(pages: unknown): ViewerTeam[] {
  return viewerTeamsSchema
    .parse(pages)
    .flat()
    .map(({ slug, name, organization }) => ({ team: `${organization.login}/${slug}`, name }))
    .sort((a, b) => a.team.localeCompare(b.team));
}

/** Reads the pages of `gh api --paginate --slurp orgs/<org>/teams/<slug>/members` as lowercase logins. */
export function parseTeamMembers(pages: unknown): string[] {
  return teamMembersSchema
    .parse(pages)
    .flat()
    .map(({ login }) => login.toLowerCase());
}

export function viewerTeamsArgs(): string[] {
  return ["api", "--paginate", "--slurp", "user/teams?per_page=100"];
}

export function teamMembersArgs(team: string): string[] {
  const [org, slug] = teamSchema.parse(team).split("/");
  return ["api", "--paginate", "--slurp", `orgs/${org}/teams/${slug}/members?per_page=100`];
}
