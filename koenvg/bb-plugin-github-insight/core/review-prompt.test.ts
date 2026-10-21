import { describe, expect, it } from "vitest";
import { buildReviewPrompt } from "./review-prompt";

describe("buildReviewPrompt", () => {
  const prompt = buildReviewPrompt({
    number: 15,
    title: "Add rate limits",
    url: "https://github.com/acme/api/pull/15",
  });

  it("starts with checking out the PR", () => {
    expect(prompt).toContain("`gh pr checkout 15`");
    expect(prompt.indexOf("gh pr checkout")).toBeLessThan(prompt.indexOf("Review the change"));
  });

  it("names the PR URL and title", () => {
    expect(prompt).toContain("https://github.com/acme/api/pull/15");
    expect(prompt).toContain("Add rate limits");
  });

  it("tells the agent not to post to GitHub", () => {
    expect(prompt).toContain("Do not post comments or reviews to GitHub");
  });

  it("names both draft commands", () => {
    expect(prompt).toContain(
      "bb github-insight review comment <path> --line <n> --body-file <file>",
    );
    expect(prompt).toContain("bb github-insight review summary --body-file <file>");
  });

  it("names the commands that fix or remove a draft", () => {
    expect(prompt).toContain("bb github-insight review comment edit <draft-id> --body-file <file>");
    expect(prompt).toContain("bb github-insight review comment delete <draft-id>");
  });

  it("saves findings as drafts, not as a chat report", () => {
    expect(prompt).not.toContain("Report your findings here");
  });
});
