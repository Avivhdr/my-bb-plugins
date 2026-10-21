import { describe, expect, it } from "vitest";
import { parsePullRequestUrl } from "./pr-ref";

describe("parsePullRequestUrl", () => {
  it("reads owner, repo, and number from a github.com PR url", () => {
    expect(parsePullRequestUrl("https://github.com/collibra/frontend/pull/25337")).toEqual({
      owner: "collibra",
      repo: "frontend",
      number: 25337,
    });
  });

  it.each([
    "https://gitlab.com/collibra/frontend/merge_requests/1",
    "https://github.com/collibra/frontend/issues/1",
    "not a url",
  ])("gives null for %s", (url) => {
    expect(parsePullRequestUrl(url)).toBeNull();
  });
});
