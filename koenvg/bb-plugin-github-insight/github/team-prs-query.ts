import type { TeamPrPageRequest } from "../contract";

const TEAM_PR_PAGE_SIZE = 100;

export const VIEWER_TEAMS_ARGS = ["api", "--paginate", "--slurp", "user/teams?per_page=100"];

const TEAM_PR_QUERY = `
query ($q: String!, $after: String) {
  viewer { login }
  search(type: ISSUE, first: ${TEAM_PR_PAGE_SIZE}, after: $after, query: $q) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        updatedAt
        repository { nameWithOwner }
        timelineItems(last: 30, itemTypes: [REVIEW_REQUESTED_EVENT]) {
          nodes {
            ... on ReviewRequestedEvent {
              requestedReviewer { __typename ... on User { login } ... on Team { combinedSlug } }
            }
          }
        }
      }
    }
  }
}
`;

function searchTime(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function teamPrPageArgs({ repo, since, after }: TeamPrPageRequest): string[] {
  const q = `is:pr repo:${repo} updated:>=${searchTime(since)} sort:updated-asc`;
  const args = ["api", "graphql", "-f", `query=${TEAM_PR_QUERY}`, "-f", `q=${q}`];
  if (after !== null) args.push("-f", `after=${after}`);
  return args;
}
