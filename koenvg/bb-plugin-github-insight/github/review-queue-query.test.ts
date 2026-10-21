import { describe, expect, it } from "vitest";
import type { PullRequestRef } from "../core/pr-ref";
import { reviewQueueBatchArgs } from "./review-queue-query";

function firstRequest(tracked: PullRequestRef[]): string[] {
  return reviewQueueBatchArgs(tracked)[0]!;
}

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))!;
}

describe("reviewQueueBatchArgs first request", () => {
  it("asks for the review requests in one GraphQL search when nothing is tracked", () => {
    expect(firstRequest([])).toMatchSnapshot();
  });

  it("asks for each tracked PR by repository and number in the same request", () => {
    expect(
      firstRequest([
        { owner: "acme", repo: "api", number: 15 },
        { owner: "acme", repo: "web", number: 3 },
      ]),
    ).toMatchSnapshot();
  });

  it("asks for comment and request activity on tracked PRs only", () => {
    const query = queryOf(firstRequest([{ owner: "acme", repo: "api", number: 15 }]));

    expect(query).toContain("viewer { login }");
    expect(query).toContain("nodes { ...QueuePr }");
    expect(query).toContain("pullRequest(number: $n0) { ...QueuePr ...QueueActivity }");
  });

  it("asks for the id of each PR comment and review, so a seen one stops counting", () => {
    const query = queryOf(firstRequest([{ owner: "acme", repo: "api", number: 15 }]));

    expect(query).toContain("comments(last: 10) { nodes { id createdAt");
    expect(query).toMatch(/reviews\(last: 10\) \{\s+nodes \{ id submittedAt/);
  });

  it("passes the tracked repository names as variables, not inside the query", () => {
    const args = firstRequest([{ owner: 'acme"', repo: "api", number: 15 }]);
    const query = queryOf(args);

    expect(query).not.toContain("acme");
    expect(args).toContain('o0=acme"');
  });

  it("asks for at most 10 inline comments per review", () => {
    const query = queryOf(firstRequest([{ owner: "acme", repo: "api", number: 15 }]));

    expect(query).toContain("comments(first: 10) { nodes { id createdAt publishedAt } }");
  });
});

function trackedRefs(count: number) {
  return Array.from({ length: count }, (_, number) => ({ owner: "acme", repo: "api", number }));
}

describe("reviewQueueBatchArgs", () => {
  it("sends one request when nothing is tracked", () => {
    expect(reviewQueueBatchArgs([])).toHaveLength(1);
  });

  it("asks for at most 8 tracked PRs per request", () => {
    const batches = reviewQueueBatchArgs(trackedRefs(17));

    expect(batches.map((args) => queryOf(args).match(/ t\d+: repository/g)?.length)).toEqual([
      8, 8, 1,
    ]);
  });

  it("asks for the review requests in the first request only", () => {
    const batches = reviewQueueBatchArgs(trackedRefs(9));

    expect(queryOf(batches[0]!)).toContain("reviewRequests: search(");
    expect(queryOf(batches[1]!)).not.toContain("reviewRequests: search(");
    expect(queryOf(batches[1]!)).toContain("viewer { login }");
  });

  it("keeps each tracked PR at its own alias and variables across requests", () => {
    const second = reviewQueueBatchArgs(trackedRefs(9))[1]!;

    expect(queryOf(second)).toContain(
      "t8: repository(owner: $o8, name: $r8) { pullRequest(number: $n8)",
    );
    expect(second).toContain("n8=8");
  });
});
