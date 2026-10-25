// What a thread started from an issue is told. The server's start-thread call and
// the frontend's "Draft in new thread" share this prompt.

export function issueUrl(repo: string, issueNumber: number): string {
  return `https://github.com/${repo}/issues/${issueNumber}`
}

/**
 * The new-thread input for one issue. The GitHub link sits on its own line.
 * The person writes their own instructions under it.
 */
export function issueThreadComposerText(repo: string, issueNumber: number): string {
  return `${issueUrl(repo, issueNumber)}\n`
}

/**
 * A reference, not a copy. The agent reads the issue itself when it needs the body,
 * so it sees the issue as it stands rather than as it was when the button was
 * clicked, and the prompt stays short enough to read and edit.
 */
export function buildIssueThreadPrompt(repo: string, issueNumber: number, title: string): string {
  return [`Implement GitHub issue #${issueNumber}: ${title}`, '', issueUrl(repo, issueNumber)].join('\n')
}

/** The sidebar title for a thread started from an issue. */
export function issueThreadTitle(issueNumber: number, title: string): string {
  const trimmed = title.trim()
  return trimmed ? `#${issueNumber} ${trimmed}` : `Issue #${issueNumber}`
}
