import { z } from "zod";
import type { PullRequestRef } from "./pr-ref";

export const TEAM_SCAN_MAX_PAGES = 10;

const viewerTeamsSchema = z.array(
  z.array(z.object({ slug: z.string(), organization: z.object({ login: z.string() }) })),
);

const requestedReviewerSchema = z
  .object({
    __typename: z.string(),
    login: z.string().optional(),
    combinedSlug: z.string().optional(),
  })
  .nullable();

const teamPrPageSchema = z.object({
  data: z.object({
    viewer: z.object({ login: z.string() }),
    search: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(
        z
          .object({
            number: z.number(),
            updatedAt: z.string(),
            repository: z.object({ nameWithOwner: z.string() }),
            timelineItems: z.object({
              nodes: z.array(z.object({ requestedReviewer: requestedReviewerSchema.optional() })),
            }),
          })
          .nullable(),
      ),
    }),
  }),
});
type RequestedReviewer = z.infer<typeof requestedReviewerSchema>;

export interface TeamPrPage {
  refs: PullRequestRef[];
  lastUpdatedAt: string | null;
  after: string | null;
}

export interface RepoSince {
  repo: string;
  since: string;
}

export interface TeamScanRequest {
  repos: RepoSince[];
  startedAt: string;
}

export interface TeamScan {
  refs: PullRequestRef[];
  scannedThrough: Record<string, string>;
}

export interface TeamScanSource {
  fetchViewerTeams(): Promise<unknown>;
  fetchPage(page: RepoSince & { after: string | null }): Promise<unknown>;
}

export function parseViewerTeams(response: unknown): Set<string> {
  return new Set(
    viewerTeamsSchema
      .parse(response)
      .flat()
      .map((team) => `${team.organization.login}/${team.slug}`.toLowerCase()),
  );
}

function isViewerOrTeam(
  reviewer: RequestedReviewer | undefined,
  viewer: string,
  teams: ReadonlySet<string>,
): boolean {
  if (reviewer?.__typename === "User") return reviewer.login?.toLowerCase() === viewer;
  if (reviewer?.__typename === "Team") return teams.has(reviewer.combinedSlug?.toLowerCase() ?? "");
  return false;
}

export function parseTeamPrPage(response: unknown, teams: ReadonlySet<string>): TeamPrPage {
  const { viewer, search } = teamPrPageSchema.parse(response).data;
  const login = viewer.login.toLowerCase();
  const nodes = search.nodes.filter((node) => node !== null);
  const refs = nodes.flatMap(({ number, repository, timelineItems }): PullRequestRef[] => {
    const [owner, repo] = repository.nameWithOwner.toLowerCase().split("/");
    const requested = timelineItems.nodes.some(({ requestedReviewer }) =>
      isViewerOrTeam(requestedReviewer, login, teams),
    );
    return requested && owner && repo ? [{ owner, repo, number }] : [];
  });
  return {
    refs,
    lastUpdatedAt: nodes.at(-1)?.updatedAt ?? null,
    after: search.pageInfo.hasNextPage ? search.pageInfo.endCursor : null,
  };
}

async function scanRepo(
  source: TeamScanSource,
  teams: ReadonlySet<string>,
  { repo, since }: RepoSince,
  startedAt: string,
): Promise<{ refs: PullRequestRef[]; through: string }> {
  const refs: PullRequestRef[] = [];
  let after: string | null = null;
  let through = since;
  for (let page = 0; page < TEAM_SCAN_MAX_PAGES; page++) {
    const parsed = parseTeamPrPage(await source.fetchPage({ repo, since, after }), teams);
    refs.push(...parsed.refs);
    through = parsed.lastUpdatedAt ?? through;
    if (parsed.after === null) return { refs, through: startedAt };
    after = parsed.after;
  }
  // The search returns the oldest update first, so a capped scan resumes after its last PR.
  return { refs, through };
}

export async function scanTeamPrs(
  source: TeamScanSource,
  { repos, startedAt }: TeamScanRequest,
): Promise<TeamScan> {
  const teams = parseViewerTeams(await source.fetchViewerTeams());
  const scans = await Promise.all(
    repos.map(async (repo) => ({
      repo: repo.repo,
      ...(await scanRepo(source, teams, repo, startedAt)),
    })),
  );
  return {
    refs: scans.flatMap((scan) => scan.refs),
    scannedThrough: Object.fromEntries(scans.map((scan) => [scan.repo, scan.through])),
  };
}
