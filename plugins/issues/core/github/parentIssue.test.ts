import { describe, expect, it } from 'vitest'
import { parentIssueNumberFromUrl } from './parentIssue'

const REPO = { owner: 'Avivhdr', name: 'JuDI' }

describe('parentIssueNumberFromUrl', () => {
  it('reads a same-repo parent number from GitHub\'s REST parent_issue_url', () => {
    expect(
      parentIssueNumberFromUrl('https://api.github.com/repos/Avivhdr/JuDI/issues/35', REPO),
    ).toBe(35)
  })

  it('is case-insensitive on owner and repo', () => {
    expect(
      parentIssueNumberFromUrl('https://api.github.com/repos/avivhdr/judi/issues/35', REPO),
    ).toBe(35)
  })

  it('returns null when the parent lives in a different repository', () => {
    expect(
      parentIssueNumberFromUrl('https://api.github.com/repos/other/repo/issues/35', REPO),
    ).toBeNull()
  })

  it('returns null for a missing, empty, or malformed URL', () => {
    expect(parentIssueNumberFromUrl(null, REPO)).toBeNull()
    expect(parentIssueNumberFromUrl(undefined, REPO)).toBeNull()
    expect(parentIssueNumberFromUrl('', REPO)).toBeNull()
    expect(parentIssueNumberFromUrl('not a url', REPO)).toBeNull()
    expect(parentIssueNumberFromUrl('https://api.github.com/repos/Avivhdr/JuDI/pulls/35', REPO)).toBeNull()
  })
})
