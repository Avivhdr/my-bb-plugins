import type { CheckRunDetailsRequest } from "../contract";

const CHECK_RUN_DETAILS_QUERY = `
query ($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on CheckRun {
      id
      annotations(first: 100) {
        nodes { annotationLevel message path location { start { line } } }
      }
    }
  }
}
`;

export function checkRunDetailsArgs(request: CheckRunDetailsRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${CHECK_RUN_DETAILS_QUERY}`,
    ...request.ids.flatMap((id) => ["-f", `ids[]=${id}`]),
  ];
}
