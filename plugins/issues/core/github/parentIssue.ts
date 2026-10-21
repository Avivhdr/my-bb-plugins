import type { RepoRef } from '../types'

const PARENT_PATH = /\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/?$/

/**
 * Same-repo parent issue number from GitHub's `parent_issue_url`, or null when
 * the issue has no parent, the URL is malformed, or the parent lives in another
 * repository (this board is per-repo and cannot nest a cross-repo parent).
 */
export function parentIssueNumberFromUrl(
  parentIssueUrl: string | null | undefined,
  repo: RepoRef,
): number | null {
  if (!parentIssueUrl) return null

  let pathname: string
  try {
    pathname = new URL(parentIssueUrl).pathname
  } catch {
    return null
  }

  const match = pathname.match(PARENT_PATH)
  if (!match) return null

  const [, owner, name, number] = match
  if (owner.toLowerCase() !== repo.owner.toLowerCase()) return null
  if (name.toLowerCase() !== repo.name.toLowerCase()) return null

  const parsed = Number(number)
  if (!Number.isInteger(parsed) || parsed < 1) return null
  return parsed
}
