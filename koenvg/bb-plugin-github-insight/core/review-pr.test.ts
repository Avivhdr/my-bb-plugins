import { describe, expect, it } from "vitest";
import { readReviewPr, reviewPrMetadata, type ReviewPr } from "./review-pr";

const pr: ReviewPr = {
  repo: "acme/api",
  number: 15,
  title: "Add rate limits",
  url: "https://github.com/acme/api/pull/15",
};

describe("review-pr metadata", () => {
  it("writes a version 1 entry under the review-pr key", () => {
    expect(reviewPrMetadata(pr)).toEqual({ "review-pr": { v: 1, ...pr } });
  });

  it("reads back the entry it writes", () => {
    expect(readReviewPr({ prSummary: {}, ...reviewPrMetadata(pr) })).toEqual(pr);
  });

  it.each([
    ["no metadata", null],
    ["metadata that is not an object", "review-pr"],
    ["metadata without the entry", { prSummary: {} }],
    ["an entry without a version", { "review-pr": pr }],
    ["an entry of another version", { "review-pr": { ...pr, v: 2 } }],
    ["an entry without a number", { "review-pr": { ...pr, v: 1, number: undefined } }],
    ["an entry with a text number", { "review-pr": { ...pr, v: 1, number: "15" } }],
    ["an entry with an empty repo", { "review-pr": { ...pr, v: 1, repo: "" } }],
  ])("reads %s as no review PR", (_, metadata) => {
    expect(readReviewPr(metadata)).toBeNull();
  });
});
