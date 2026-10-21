import type { AddCommentRequest } from "../contract";

const ADD_COMMENT_MUTATION = `
mutation ($subjectId: ID!, $body: String!) {
  addComment(input: { subjectId: $subjectId, body: $body }) { commentEdge { node { id } } }
}
`;

// `-f` sends the value as a raw string: gh does not read `@file` or convert types.
export function addCommentArgs({ subjectId, body }: AddCommentRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${ADD_COMMENT_MUTATION}`,
    "-f",
    `subjectId=${subjectId}`,
    "-f",
    `body=${body}`,
  ];
}
