import type { QueuePr } from "./review-queue";

type PromptPr = Pick<QueuePr, "number" | "title" | "url"> & { repo?: string };

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

const COMMENT_STEP =
  "Save each finding as a comment draft on its file and line: `bb github-insight review comment <path> --line <n> --body-file <file>`. Add `--start-line <n>` for a range, and `--side LEFT` for a removed line. When the command fails, read the diff ranges in its message and pick a line in them.";

const SUMMARY_STEP =
  'Save one review summary with `bb github-insight review summary --body-file <file>`. Follow "Summary rules" below.';

const CHECK_DRAFTS_STEP =
  "Run `bb github-insight review list` to check the drafts. Fix a wrong draft with `bb github-insight review comment edit <draft-id> --body-file <file>`, and remove a duplicate with `bb github-insight review comment delete <draft-id>`. Then tell me that the drafts are ready in the Files sub-tab of the PR tab.";

const NO_POSTING_RULE =
  "- Do not post comments or reviews to GitHub. I edit the drafts and submit the review from the Files sub-tab of the PR tab.";

const NO_VERDICT_RULE =
  '- Don\'t write a verdict line such as "Ready to approve" or "Still blocking". I decide whether to approve.';

function sections(howToReview: string, summaryRules: string[], rules: string[]): string {
  return [
    "## How to review",
    howToReview,
    "## Summary rules",
    summaryRules.join("\n"),
    "## Rules",
    rules.join("\n"),
  ].join("\n\n");
}

/**
 * The part of the review prompt that the user can change in the plugin settings: everything after
 * the Steps.
 */
export const DEFAULT_REVIEW_INSTRUCTIONS = sections(
  [
    "Read the PR description and the diff against its base branch.",
    "Review the change for correctness, design, tests, and readability.",
  ].join("\n"),
  [
    "- List only the findings that need an answer or a change, in a sentence each. Point to the inline comments; don't repeat them in full.",
    "- Don't describe what the PR does or praise anything in it.",
    NO_VERDICT_RULE,
    "- Don't explain how you reviewed: which files you read, what you ran, what you checked and found fine.",
    '- If nothing needs work, write one short line saying so, for example "No issues found."',
  ],
  [
    NO_POSTING_RULE,
    "- Every comment and the summary cover only things that need clarification or a change. Leave out anything that was fine.",
    "- Your chat report to me follows the same rule: findings and anything you couldn't verify, nothing else.",
  ],
);

/** The part of the re-review prompt that the user can change in the plugin settings. */
export const DEFAULT_RE_REVIEW_INSTRUCTIONS = sections(
  "Review the new commits for correctness, design, tests, and readability.",
  [
    "- List only what still needs work:",
    "  - earlier comments that are partly resolved or not resolved, with what's still missing",
    "  - author pushback whose reasoning doesn't hold, with why",
    "  - new findings from step 6, in a sentence each",
    "- Don't list resolved comments. Don't restate what the PR or the author's replies already say was fixed.",
    NO_VERDICT_RULE,
    "- Don't explain how you reviewed: rebases, range-diff, which commits you compared, what you ran.",
    '- If nothing needs work, write one short line saying so, for example "All comments addressed, no new issues."',
  ],
  [
    NO_POSTING_RULE,
    "- Every comment, reply, and summary covers only things that need clarification or a change. Leave out anything that was fine.",
    "- Your chat report to me follows the same rule: gaps and anything you couldn't verify, nothing else.",
  ],
);

/**
 * Settings saved before the summary rules and rules were editable held only the "How to review"
 * text. Keeps that text as the section and takes the rest from the defaults.
 */
export function withDefaultRules(howToReview: string, defaults: string): string {
  const rest = defaults.indexOf("## Summary rules");
  return `## How to review\n\n${howToReview.trim()}\n\n${defaults.slice(rest)}`;
}

function numbered(steps: readonly string[]): string {
  return steps.map((step, i) => `${i + 1}. ${step}`).join("\n");
}

/**
 * The prompt of a review thread: the plugin's Steps, then the user's text from the settings. The
 * plugin owns the Steps, because the Files sub-tab only shows drafts saved with those commands.
 */
export function buildReviewPrompt(
  pr: PromptPr,
  instructions: string = DEFAULT_REVIEW_INSTRUCTIONS,
): string {
  return `${reviewPromptHead(pr)}\n\n${fillPlaceholders(instructions.trim(), pr)}\n`;
}

/** The part of the review prompt that the plugin writes: the header and the Steps. */
export function reviewPromptHead(pr: PromptPr): string {
  return [
    `Review pull request #${pr.number}: ${pr.title}`,
    pr.url,
    "## Steps",
    numbered([
      `Run \`gh pr checkout ${pr.number}\`.`,
      'Review the PR as "How to review" below says.',
      COMMENT_STEP,
      SUMMARY_STEP,
      CHECK_DRAFTS_STEP,
    ]),
  ].join("\n\n");
}

/** The commit and time of the user's last review, from the reviewed mark. */
export interface ReReviewBasis {
  reviewedOid: string;
  reviewedAt: number;
}

/**
 * The follow-up that Re-review sends to an existing review thread: pull the new commits, judge
 * whether the user's earlier comments are resolved, and review only what changed since.
 */
export function buildReReviewPrompt(
  pr: PromptPr & { repo: string },
  basis: ReReviewBasis,
  instructions: string = DEFAULT_RE_REVIEW_INSTRUCTIONS,
): string {
  return `${reReviewPromptHead(pr, basis)}\n\n${fillPlaceholders(instructions.trim(), pr)}\n`;
}

/** The part of the re-review prompt that the plugin writes: the header, the review basis, and the Steps. */
export function reReviewPromptHead(
  pr: PromptPr & { repo: string },
  { reviewedOid, reviewedAt }: ReReviewBasis,
): string {
  return [
    `Re-review pull request #${pr.number}: ${pr.title}`,
    pr.url,
    `I reviewed this PR at commit ${reviewedOid} (${new Date(reviewedAt).toISOString()}). Since then the author pushed commits, replied to comments, or asked for my review again. Check what changed and whether my earlier comments are resolved.`,
    "## Steps",
    numbered([
      `Run \`gh pr checkout ${pr.number} --force\` to get the latest commits.`,
      `Read what changed since my review: \`git diff ${reviewedOid}..HEAD\`. If git doesn't know ${reviewedOid}, or the diff is full of base-branch changes because the author rebased, compare only the PR's own commits (for example with \`git range-diff\`).`,
      `Read my earlier comments and the replies to them. My comments are the ones by \`gh api user --jq .login\`. \`bb github-insight review list\` shows the unresolved review threads with their ids. \`gh api repos/${pr.repo}/pulls/${pr.number}/comments --paginate\` also shows resolved threads, and \`gh pr view ${pr.number} --comments\` shows the conversation.`,
      "For each of my comments, decide whether the new code and the reply resolve it: resolved, partly resolved, or not resolved. When the author disagreed, judge whether the reasoning holds.",
      "When an unresolved thread needs an answer, save a draft reply: `bb github-insight review draft <thread-id> --body-file <file>`. A resolved thread takes no reply, so when one isn't really fixed, put it in the summary.",
      `Review the new commits as "How to review" below says. Comment only on code that changed since ${reviewedOid}. ${COMMENT_STEP}`,
      SUMMARY_STEP,
      CHECK_DRAFTS_STEP,
    ]),
  ].join("\n\n");
}
