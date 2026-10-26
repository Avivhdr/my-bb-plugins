import { describe, expect, it } from "vitest";
import type { PullRequestRef } from "../core/pr-ref";
import { reviewQueueBatchArgs } from "./review-queue-query";

const LAYERS = [
  "is:pr is:open user-review-requested:@me",
  'is:pr is:open review-requested:@me -label:"DO NOT REVIEW"',
];

function firstRequest(tracked: PullRequestRef[]): string[] {
  return reviewQueueBatchArgs(LAYERS, tracked)[0]!;
}

function queryOf(args: string[]): string {
  return args.find((arg) => arg.startsWith("query="))!;
}

describe("reviewQueueBatchArgs first request", () => {
  it("asks for each layer in its own GraphQL search when nothing is tracked", () => {
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
    expect(query).toContain("labels(first: 20) { nodes { name } }");
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

  it("passes each layer query as a variable, so quotes in it need no escaping", () => {
    const args = firstRequest([]);
    const query = queryOf(args);

    expect(query).toContain("query($q0: String!, $q1: String!) {");
    expect(query).toContain("l0: search(type: ISSUE, first: 50, query: $q0)");
    expect(query).toContain("l1: search(type: ISSUE, first: 50, query: $q1)");
    expect(query).not.toContain("review-requested");
    expect(args).toContain(`q1=${LAYERS[1]}`);
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
    expect(reviewQueueBatchArgs(LAYERS, [])).toHaveLength(1);
  });

  it("asks for at most 8 tracked PRs per request", () => {
    const batches = reviewQueueBatchArgs(LAYERS, trackedRefs(17));

    expect(batches.map((args) => queryOf(args).match(/ t\d+: repository/g)?.length)).toEqual([
      8, 8, 1,
    ]);
  });

  it("asks for the layer searches in the first request only", () => {
    const batches = reviewQueueBatchArgs(LAYERS, trackedRefs(9));

    expect(queryOf(batches[0]!)).toContain("l0: search(");
    expect(queryOf(batches[1]!)).not.toContain("search(");
    expect(queryOf(batches[1]!)).not.toContain("$q0");
    expect(queryOf(batches[1]!)).toContain("viewer { login }");
  });

  it("keeps each tracked PR at its own alias and variables across requests", () => {
    const second = reviewQueueBatchArgs(LAYERS, trackedRefs(9))[1]!;

    expect(queryOf(second)).toContain(
      "t8: repository(owner: $o8, name: $r8) { pullRequest(number: $n8)",
    );
    expect(second).toContain("n8=8");
  });
});
