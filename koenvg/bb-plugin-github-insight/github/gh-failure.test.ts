import { describe, expect, it } from "vitest";
import {
  classifyGhFailure,
  ghFailureText,
  isGithubTimeout,
  parseGraphqlRateLimitReset,
} from "./gh-failure";

describe("classifyGhFailure", () => {
  it("reports gh not installed when the binary is missing", () => {
    expect(classifyGhFailure({ code: "ENOENT", stderr: "", message: "spawn gh ENOENT" })).toEqual({
      kind: "gh_missing",
    });
  });

  it("reports gh not logged in for a gh without a login", () => {
    expect(
      classifyGhFailure({
        code: 4,
        stderr:
          "To get started with GitHub CLI, please run:  gh auth login\n" +
          "Alternatively, populate the GH_TOKEN environment variable with a GitHub API authentication token.\n",
        message: "Command failed: gh api graphql",
      }),
    ).toEqual({ kind: "gh_logged_out" });
  });

  it("reports gh not logged in for a token that GitHub rejects", () => {
    expect(
      classifyGhFailure({
        code: 1,
        stderr: "gh: Bad credentials (HTTP 401)\n",
        message: "Command failed: gh api graphql",
      }),
    ).toEqual({ kind: "gh_logged_out" });
  });

  it.each([
    "GraphQL: API rate limit exceeded for user ID 1234567.\n",
    "gh: API rate limit exceeded for user ID 1234567. (HTTP 403)\n",
    "gh: You have exceeded a secondary rate limit. Please wait a few minutes before you try again. (HTTP 403)\n",
  ])("reports rate limited for %j", (stderr) => {
    expect(
      classifyGhFailure({ code: 1, stderr, message: "Command failed: gh api graphql" }),
    ).toEqual({ kind: "rate_limited", resetAt: null });
  });

  it("keeps the gh error text for other failures", () => {
    expect(
      classifyGhFailure({
        code: 1,
        stderr: "GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)\n",
        message: "Command failed: gh api graphql",
      }),
    ).toEqual({
      kind: "failed",
      message: "GraphQL: Could not resolve to a Repository with the name 'o/r'. (repository)",
    });
  });

  it("falls back to the process message when stderr is empty", () => {
    expect(
      classifyGhFailure({ code: "ETIMEDOUT", stderr: "", message: "spawn gh ETIMEDOUT" }),
    ).toEqual({ kind: "failed", message: "spawn gh ETIMEDOUT" });
  });
});

describe("ghFailureText", () => {
  it.each([
    [{ kind: "gh_missing" } as const, "gh not installed"],
    [{ kind: "gh_logged_out" } as const, "gh not logged in"],
    [{ kind: "rate_limited", resetAt: 1_790_000_000_000 } as const, "rate limited"],
    [{ kind: "failed", message: "boom" } as const, "boom"],
  ])("gives the text for %j", (failure, text) => {
    expect(ghFailureText(failure)).toBe(text);
  });
});

describe("parseGraphqlRateLimitReset", () => {
  it("reads the GraphQL reset time in milliseconds", () => {
    expect(
      parseGraphqlRateLimitReset({
        resources: {
          core: { limit: 5000, remaining: 4999, reset: 1_790_000_100 },
          graphql: { limit: 5000, remaining: 0, reset: 1_790_000_000 },
        },
      }),
    ).toBe(1_790_000_000_000);
  });

  it("gives null while GraphQL points remain, as for a secondary rate limit", () => {
    expect(
      parseGraphqlRateLimitReset({
        resources: { graphql: { limit: 5000, remaining: 4200, reset: 1_790_000_000 } },
      }),
    ).toBeNull();
  });

  it("gives null for a response without a GraphQL reset time", () => {
    expect(parseGraphqlRateLimitReset({ message: "Not Found" })).toBeNull();
  });
});

describe("isGithubTimeout", () => {
  it.each(["gh: HTTP 504", "unexpected end of JSON input"])("is true for %s", (message) => {
    expect(isGithubTimeout({ kind: "failed", message })).toBe(true);
  });

  it("is false for other failures", () => {
    expect(isGithubTimeout({ kind: "failed", message: "gh: HTTP 502" })).toBe(false);
    expect(isGithubTimeout({ kind: "gh_logged_out" })).toBe(false);
  });
});
