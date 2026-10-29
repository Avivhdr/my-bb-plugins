import { describe, expect, it } from "vitest";
import {
  buildReReviewPrompt,
  buildReviewPrompt,
  DEFAULT_RE_REVIEW_INSTRUCTIONS,
  DEFAULT_REVIEW_INSTRUCTIONS,
  fillPlaceholders,
  withDefaultRules,
} from "./review-prompt";

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

  it("adds the summary rules and the rule against padding", () => {
    expect(prompt).toContain(
      'Save one review summary with `bb github-insight review summary --body-file <file>`. Follow "Summary rules" below.',
    );
    expect(prompt).toContain(
      "## Summary rules\n\n- List only the findings that need an answer or a change",
    );
    expect(prompt).toContain("I decide whether to approve.");
    expect(prompt).toContain(
      "Every comment and the summary cover only things that need clarification or a change.",
    );
  });

  it("saves findings as drafts, not as a chat report", () => {
    expect(prompt).not.toContain("Report your findings here");
  });
});

describe("buildReviewPrompt with custom instructions", () => {
  const pr = {
    number: 15,
    title: "Add rate limits",
    url: "https://github.com/acme/api/pull/15",
    repo: "acme/api",
  };
  const prompt = buildReviewPrompt(pr, "  Focus on {repo}#{number}: {title}.\nIgnore {style}.  ");

  it("ends with the instructions after the Steps, with placeholders filled", () => {
    expect(prompt).toMatch(
      /in the Files sub-tab of the PR tab\.\n\nFocus on acme\/api#15: Add rate limits\.\nIgnore \{style\}\.\n$/,
    );
  });

  it("keeps the checkout and the draft commands, and adds no default sections", () => {
    expect(prompt).toContain("`gh pr checkout 15`");
    expect(prompt).toContain("bb github-insight review summary --body-file <file>");
    expect(prompt).not.toContain("## How to review");
    expect(prompt).not.toContain("## Rules");
  });

  it("uses the default instructions when none are given", () => {
    expect(buildReviewPrompt(pr)).toBe(buildReviewPrompt(pr, DEFAULT_REVIEW_INSTRUCTIONS));
  });
});

describe("buildReReviewPrompt", () => {
  const pr = {
    number: 15,
    title: "Add rate limits",
    url: "https://github.com/acme/api/pull/15",
    repo: "acme/api",
  };
  const basis = { reviewedOid: "abc123", reviewedAt: Date.parse("2026-10-07T08:30:00Z") };
  const prompt = buildReReviewPrompt(pr, basis, "Focus on {repo}.");

  it("names the PR and when it was reviewed", () => {
    expect(prompt).toContain("Re-review pull request #15: Add rate limits");
    expect(prompt).toContain("https://github.com/acme/api/pull/15");
    expect(prompt).toContain("at commit abc123 (2026-10-07T08:30:00.000Z)");
  });

  it("pulls the latest commits before diffing from the reviewed commit", () => {
    expect(prompt).toContain("`gh pr checkout 15 --force`");
    expect(prompt).toContain("`git diff abc123..HEAD`");
    expect(prompt.indexOf("gh pr checkout")).toBeLessThan(prompt.indexOf("git diff"));
  });

  it("compares only the PR's own commits after a rebase", () => {
    expect(prompt).toContain("If git doesn't know abc123");
    expect(prompt).toContain(
      "compare only the PR's own commits (for example with `git range-diff`)",
    );
  });

  it("puts a resolved thread that is not really fixed in the summary", () => {
    expect(prompt).toContain("A resolved thread takes no reply");
  });

  it("reads the earlier comments, also resolved ones, and drafts replies", () => {
    expect(prompt).toContain("`gh api repos/acme/api/pulls/15/comments --paginate`");
    expect(prompt).toContain("`gh pr view 15 --comments`");
    expect(prompt).toContain("resolved, partly resolved, or not resolved");
    expect(prompt).toContain("bb github-insight review draft <thread-id> --body-file <file>");
  });

  it("saves new findings as drafts and a summary that lists only what still needs work", () => {
    expect(prompt).toContain("Comment only on code that changed since abc123");
    expect(prompt).toContain(
      "bb github-insight review comment <path> --line <n> --body-file <file>",
    );
    expect(prompt).toContain(
      '7. Save one review summary with `bb github-insight review summary --body-file <file>`. Follow "Summary rules" below.',
    );
  });

  it("uses the re-review defaults when no instructions are given", () => {
    const fromDefaults = buildReReviewPrompt(pr, basis);
    expect(fromDefaults).toContain(`\n\n${DEFAULT_RE_REVIEW_INSTRUCTIONS}\n`);
    expect(fromDefaults).toContain("## Summary rules\n\n- List only what still needs work:");
    expect(fromDefaults).toContain("Don't list resolved comments.");
    expect(fromDefaults).toContain("I decide whether to approve.");
    expect(fromDefaults).toContain("Do not post comments or reviews to GitHub");
  });

  it("ends with the instructions after the Steps, with placeholders filled", () => {
    expect(prompt).toMatch(/in the Files sub-tab of the PR tab\.\n\nFocus on acme\/api\.\n$/);
  });
});

describe("default instructions", () => {
  it.each([
    ["review", DEFAULT_REVIEW_INSTRUCTIONS, "Review the change for correctness"],
    ["re-review", DEFAULT_RE_REVIEW_INSTRUCTIONS, "Review the new commits for correctness"],
  ])("holds How to review, Summary rules, and Rules for %s", (_, defaults, howToReview) => {
    expect(defaults.startsWith("## How to review\n\n")).toBe(true);
    expect(defaults).toContain(howToReview);
    expect(defaults.indexOf("## Summary rules")).toBeGreaterThan(0);
    expect(defaults.indexOf("## Rules")).toBeGreaterThan(defaults.indexOf("## Summary rules"));
    expect(defaults).toContain("Don't write a verdict line");
  });
});

describe("withDefaultRules", () => {
  it("keeps old How to review text and adds the default Summary rules and Rules", () => {
    const text = withDefaultRules("  Only check tests.\n", DEFAULT_REVIEW_INSTRUCTIONS);

    expect(text.startsWith("## How to review\n\nOnly check tests.\n\n## Summary rules\n\n")).toBe(
      true,
    );
    expect(text).not.toContain("Review the change for correctness");
    expect(
      text.endsWith(
        DEFAULT_REVIEW_INSTRUCTIONS.slice(DEFAULT_REVIEW_INSTRUCTIONS.indexOf("## Summary rules")),
      ),
    ).toBe(true);
  });
});

describe("fillPlaceholders", () => {
  it("fills every placeholder and an unknown repo as empty", () => {
    expect(fillPlaceholders("{url} {url} {repo}", { number: 1, title: "t", url: "u" })).toBe(
      "u u ",
    );
  });
});
