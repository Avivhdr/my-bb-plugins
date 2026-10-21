import { z } from "zod";
import type { ReplyToThreadRequest, SetThreadResolvedRequest } from "../contract";

const REPLY_MUTATION = `
mutation ($threadId: ID!, $body: String!) {
  addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) {
    comment { id state }
  }
}
`;

const RESOLVE_MUTATION = `
mutation ($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}
`;

const UNRESOLVE_MUTATION = `
mutation ($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
}
`;

// `-f` sends the value as a raw string: gh does not read `@file` or convert types.
export function replyToThreadArgs({ threadId, body }: ReplyToThreadRequest): string[] {
  return [
    "api",
    "graphql",
    "-f",
    `query=${REPLY_MUTATION}`,
    "-f",
    `threadId=${threadId}`,
    "-f",
    `body=${body}`,
  ];
}

export function setThreadResolvedArgs({ threadId, resolved }: SetThreadResolvedRequest): string[] {
  const mutation = resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION;
  return ["api", "graphql", "-f", `query=${mutation}`, "-f", `threadId=${threadId}`];
}

const replyResponseSchema = z.object({
  data: z.object({
    addPullRequestReviewThreadReply: z.object({
      comment: z.object({ state: z.string() }),
    }),
  }),
});

export function isPendingReply(response: unknown): boolean {
  const parsed = replyResponseSchema.safeParse(response);
  return (
    parsed.success && parsed.data.data.addPullRequestReviewThreadReply.comment.state === "PENDING"
  );
}
