import { z } from "zod";

const OPEN_READY = "is:pr is:open draft:false archived:false";
const TEAM_REQUESTED = `${OPEN_READY} review-requested:@me -user-review-requested:@me`;

/** "only" keeps the PRs written by members of `teammatesTeam`, "exclude" drops them. */
export const teammateFilterSchema = z.enum(["only", "exclude"]);
export type TeammateFilter = z.infer<typeof teammateFilterSchema>;

export const reviewLayerSchema = z.object({
  name: z.string(),
  /** GitHub search query. Hidden repos are added as `-repo:` qualifiers. */
  query: z.string(),
  /** Repos hidden from this layer, as lowercase `owner/name`. */
  excludeRepos: z.array(z.string()).default([]),
  teammates: teammateFilterSchema.nullable().default(null),
});
export type ReviewLayer = z.infer<typeof reviewLayerSchema>;

export const reviewFiltersSchema = z.object({
  layers: z.array(reviewLayerSchema),
  /** Repos hidden from every layer, as lowercase `owner/name`. */
  excludeRepos: z.array(z.string()).default([]),
  /** PRs with one of these labels (any case) stay listed, dimmed, and are not counted. */
  skipLabels: z.array(z.string()).default([]),
  /** The GitHub team, as `org/slug`, whose members are your teammates. */
  teammatesTeam: z.string().nullable().default(null),
});
export type ReviewFilters = z.infer<typeof reviewFiltersSchema>;

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = {
  layers: [
    {
      name: "Direct",
      query: `${OPEN_READY} user-review-requested:@me`,
      excludeRepos: [],
      teammates: null,
    },
    { name: "Teammates", query: TEAM_REQUESTED, excludeRepos: [], teammates: "only" },
    { name: "Team", query: TEAM_REQUESTED, excludeRepos: [], teammates: "exclude" },
  ],
  excludeRepos: [],
  skipLabels: ["DO NOT REVIEW"],
  teammatesTeam: null,
};

/**
 * Whether a layer keeps a PR by this author. Without known teammates, a layer of teammates
 * keeps nothing and a layer without them keeps everything.
 */
export function keepsAuthor(
  layer: ReviewLayer,
  author: string | null,
  teammates: ReadonlySet<string> | null,
): boolean {
  if (layer.teammates === null) return true;
  if (teammates === null) return layer.teammates === "exclude";
  const isTeammate = author !== null && teammates.has(author.toLowerCase());
  return layer.teammates === "only" ? isTeammate : !isTeammate;
}

/** The query sent to GitHub for one layer. */
export function layerSearchQuery(layer: ReviewLayer, globalExcludes: readonly string[]): string {
  const excludes = [...new Set([...layer.excludeRepos, ...globalExcludes])].sort();
  return [layer.query, ...excludes.map((repo) => `-repo:${repo}`)].join(" ");
}

/** The first label of a PR that keeps it out of the counts, or null. */
export function skipLabelOf(
  labels: readonly string[],
  skipLabels: readonly string[],
): string | null {
  const wanted = new Set(skipLabels.map((label) => label.toLowerCase()));
  return labels.find((label) => wanted.has(label.toLowerCase())) ?? null;
}

function withRepo(repos: readonly string[], repo: string, hidden: boolean): string[] {
  const rest = repos.filter((entry) => entry !== repo);
  return hidden ? [...rest, repo] : rest;
}

/**
 * Hides a repo from one layer, or from every layer when `layer` is null. Showing it again
 * removes it from that list. Showing a repo hidden everywhere also clears it from each layer.
 */
export function setRepoHidden(
  filters: ReviewFilters,
  repo: string,
  layer: string | null,
  hidden: boolean,
): ReviewFilters {
  const key = repo.toLowerCase();
  if (layer === null) {
    return {
      ...filters,
      excludeRepos: withRepo(filters.excludeRepos, key, hidden),
      layers: hidden
        ? filters.layers
        : filters.layers.map((entry) => ({
            ...entry,
            excludeRepos: withRepo(entry.excludeRepos, key, false),
          })),
    };
  }
  return {
    ...filters,
    layers: filters.layers.map((entry) =>
      entry.name === layer
        ? { ...entry, excludeRepos: withRepo(entry.excludeRepos, key, hidden) }
        : entry,
    ),
  };
}
