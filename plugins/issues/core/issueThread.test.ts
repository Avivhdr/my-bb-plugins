import { describe, expect, it } from 'vitest'
import { buildIssueThreadPrompt, issueThreadTitle, issueUrl } from './issueThread'

describe('issue threads', () => {
  it('links to the issue on GitHub', () => {
    expect(issueUrl('acme/app', 12)).toBe('https://github.com/acme/app/issues/12')
  })

  it('references the issue rather than copying its body', () => {
    expect(buildIssueThreadPrompt('acme/app', 12, 'Fix the flaky test')).toBe(
      'Implement GitHub issue #12: Fix the flaky test\n\nhttps://github.com/acme/app/issues/12',
    )
  })

  it('titles the thread with the issue number', () => {
    expect(issueThreadTitle(12, ' Fix the flaky test ')).toBe('#12 Fix the flaky test')
    expect(issueThreadTitle(12, '  ')).toBe('Issue #12')
  })
})
