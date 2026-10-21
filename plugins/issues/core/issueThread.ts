// What a thread started from an issue is told, shared by the server's "Start thread"
// and the frontend's "Draft in new thread" so both hand the agent the same prompt.

export function issueUrl(repo: string, issueNumber: number): string {
  return `https://github.com/${repo}/issues/${issueNumber}`
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
