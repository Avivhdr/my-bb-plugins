import type { QueuePr } from "./review-queue";

type PromptPr = Pick<QueuePr, "number" | "title" | "url"> & { repo?: string };

/** The part of the review prompt that the user can change in the plugin settings. */
export const DEFAULT_REVIEW_INSTRUCTIONS = [
  "Read the PR description and the diff against its base branch.",
  "Review the change for correctness, design, tests, and readability.",
].join("\n");

export const REVIEW_PROMPT_PLACEHOLDERS = ["{number}", "{title}", "{url}", "{repo}"] as const;

/** Replaces `{number}`, `{title}`, `{url}`, and `{repo}`. Other braces stay as they are. */
export function fillPlaceholders(text: string, pr: PromptPr): string {
  const values: Record<string, string> = {
    number: String(pr.number),
    title: pr.title,
    url: pr.url,
    repo: pr.repo ?? "",
  };
  return text.replace(/\{(number|title|url|repo)\}/g, (_, name: string) => values[name]!);
}

/**
 * The prompt of a review thread. The plugin owns the checkout, the draft commands, and the rule
 * against posting, because the Files sub-tab only shows drafts saved with those commands.
 */
export function buildReviewPrompt(
  pr: PromptPr,
  instructions: string = DEFAULT_REVIEW_INSTRUCTIONS,
): string {
  return (
    [
      `Review pull request #${pr.number}: ${pr.title}`,
      pr.url,
      "## Steps",
      [
        `1. Run \`gh pr checkout ${pr.number}\`.`,
        '2. Review the PR as "How to review" below says.',
        "3. Save each finding as a comment draft on its file and line: `bb github-insight review comment <path> --line <n> --body-file <file>`. Add `--start-line <n>` for a range, and `--side LEFT` for a removed line. When the command fails, read the diff ranges in its message and pick a line in them.",
        "4. Save one review summary: `bb github-insight review summary --body-file <file>`.",
        "5. Run `bb github-insight review list` to check the drafts. Fix a wrong draft with `bb github-insight review comment edit <draft-id> --body-file <file>`, and remove a duplicate with `bb github-insight review comment delete <draft-id>`. Then tell the user that the drafts are ready in the Files sub-tab of the PR tab.",
      ].join("\n"),
      "## How to review",
      fillPlaceholders(instructions.trim(), pr),
      "## Rules",
      "- Do not post comments or reviews to GitHub. The user edits the drafts and submits the review from the Files sub-tab of the PR tab.",
    ].join("\n\n") + "\n"
  );
}
