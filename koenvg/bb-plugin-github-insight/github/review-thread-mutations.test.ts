import { describe, expect, it } from "vitest";
import {
  isPendingReply,
  replyToThreadArgs,
  setThreadResolvedArgs,
} from "./review-thread-mutations";

const THREAD = "PRRT_kwDOUpGL5s6lyX41";

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))!;
}

describe("replyToThreadArgs", () => {
  const body = `=Say "zq-unique" and 'bye'\na=b next line $(rm -rf /) @file`;

  it("passes the body as one raw GraphQL variable, unchanged", () => {
    const args = replyToThreadArgs({ threadId: THREAD, body });

    expect(args).toEqual(
      expect.arrayContaining(["-f", `body=${body}`, "-f", `threadId=${THREAD}`]),
    );
    expect(args[args.indexOf(`body=${body}`) - 1]).toBe("-f");
  });

  it("keeps the body and the thread id out of the query text", () => {
    const query = queryOf(replyToThreadArgs({ threadId: THREAD, body }));

    expect(query).toContain("addPullRequestReviewThreadReply");
    expect(query).not.toContain(THREAD);
    expect(query).not.toContain("zq-unique");
  });
});

describe("setThreadResolvedArgs", () => {
  it("resolves or unresolves the thread passed as a variable", () => {
    const resolve = setThreadResolvedArgs({ threadId: THREAD, resolved: true });
    const unresolve = setThreadResolvedArgs({ threadId: THREAD, resolved: false });

    expect(queryOf(resolve)).toContain("resolveReviewThread(");
    expect(queryOf(unresolve)).toContain("unresolveReviewThread(");
    for (const args of [resolve, unresolve]) {
      expect(args).toEqual(expect.arrayContaining(["-f", `threadId=${THREAD}`]));
      expect(queryOf(args)).not.toContain(THREAD);
    }
  });
});

describe("isPendingReply", () => {
  const reply = (state: string) => ({
    data: { addPullRequestReviewThreadReply: { comment: { id: "PRRC_1", state } } },
  });

  it("tells a reply that went into the user's pending review", () => {
    expect(isPendingReply(reply("PENDING"))).toBe(true);
    expect(isPendingReply(reply("SUBMITTED"))).toBe(false);
  });
});
