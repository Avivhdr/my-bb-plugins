import type { QueuePr } from "./review-queue";

export function buildReviewPrompt(pr: Pick<QueuePr, "number" | "title" | "url">): string {
  return (
    [
      `Review pull request #${pr.number}: ${pr.title}`,
      pr.url,
      "## Steps",
      [
        `1. Run \`gh pr checkout ${pr.number}\`.`,
        "2. Read the PR description and the diff against its base branch.",
        "3. Review the change for correctness, design, tests, and readability.",
        "4. Save each finding as a comment draft on its file and line: `bb github-insight review comment <path> --line <n> --body-file <file>`. Add `--start-line <n>` for a range, and `--side LEFT` for a removed line. When the command fails, read the diff ranges in its message and pick a line in them.",
        "5. Save one review summary: `bb github-insight review summary --body-file <file>`.",
        "6. Run `bb github-insight review list` to check the drafts. Fix a wrong draft with `bb github-insight review comment edit <draft-id> --body-file <file>`, and remove a duplicate with `bb github-insight review comment delete <draft-id>`. Then tell the user that the drafts are ready in the Files sub-tab of the PR tab.",
      ].join("\n"),
      "## Rules",
      "- Do not post comments or reviews to GitHub. The user edits the drafts and submits the review from the Files sub-tab of the PR tab.",
    ].join("\n\n") + "\n"
  );
}
