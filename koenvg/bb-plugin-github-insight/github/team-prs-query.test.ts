import { describe, expect, it } from "vitest";
import { teamPrPageArgs } from "./team-prs-query";

function variable(args: string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

describe("teamPrPageArgs", () => {
  const request = { repo: "collibra/frontend", since: "2026-10-14T09:07:45.536Z", after: null };

  it("searches the PRs of one repository updated since a time, oldest update first", () => {
    expect(variable(teamPrPageArgs(request), "q")).toBe(
      "is:pr repo:collibra/frontend updated:>=2026-10-14T09:07:45Z sort:updated-asc",
    );
  });

  it("asks for who each PR requested a review from, people and teams", () => {
    const query = variable(teamPrPageArgs(request), "query")!;

    expect(query).toContain("itemTypes: [REVIEW_REQUESTED_EVENT]");
    expect(query).toContain("... on User { login } ... on Team { combinedSlug }");
  });

  it("passes the cursor of the next page as a variable", () => {
    expect(variable(teamPrPageArgs({ ...request, after: "Y3Vyc29y" }), "after")).toBe("Y3Vyc29y");
    expect(variable(teamPrPageArgs(request), "after")).toBeUndefined();
  });
});
