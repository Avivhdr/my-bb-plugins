import { describe, it, expect } from 'vitest'
import { buildDraftPrompt, buildReviseDraftPrompt, buildReviseMessage } from './prompt'
import type { RepoContext } from './prompt'

const CONTEXT: RepoContext = {
  repo: 'acme/app',
  description: 'A desktop client',
  readme: '# Acme\nThemeProvider owns theming.',
  labels: ['bug', 'ui'],
}

describe('buildDraftPrompt', () => {
  it('carries the structured issue sections', () => {
    const p = buildDraftPrompt()
    expect(p).toContain('## Problem')
    expect(p).toContain('## Summary')
    expect(p).toContain('## Acceptance criteria')
    expect(p).toContain('## Steps to reproduce')
    expect(p).toContain('## Open questions')
  })

  it('demands a leading Problem section, and keeps the why out of Summary', () => {
    const p = buildDraftPrompt()
    expect(p).toContain('"## Problem" comes first')
    expect(p).toContain('what this changes')
  })

  it('rules out restating the request as a lack, and says where an inferred problem goes', () => {
    const p = buildDraftPrompt()
    expect(p).toContain('never "Users cannot jump to the previous message"')
    expect(p).toContain('ask about it under "## Open questions"')
  })

  it('keeps the title style rules that the delimited format used to carry', () => {
    const p = buildDraftPrompt()
    expect(p).toContain('imperative mood')
    expect(p).toContain('~80 characters')
    expect(p).toContain('never "Add Up/Down Buttons To Navigate Comments"')
  })

  it('omits the repository context block when no context is given', () => {
    expect(buildDraftPrompt()).not.toContain('Repository context')
  })

  it('weaves in description, labels, and README when context is provided', () => {
    const p = buildDraftPrompt(CONTEXT)
    expect(p).toContain('Repository context')
    expect(p).toContain('- Repository: acme/app')
    expect(p).toContain('- Description: A desktop client')
    expect(p).toContain('- Existing labels: bug, ui')
    expect(p).toContain('ThemeProvider owns theming.')
  })

  it('omits the description line when the repo has none', () => {
    const p = buildDraftPrompt({ ...CONTEXT, description: null })
    expect(p).toContain('- Repository: acme/app')
    expect(p).not.toContain('- Description:')
  })

  it('omits the README block when the project has no readable README', () => {
    const p = buildDraftPrompt({ ...CONTEXT, readme: '' })
    expect(p).toContain('- Repository: acme/app')
    expect(p).not.toContain('README excerpt')
  })
})

describe('buildReviseDraftPrompt', () => {
  it('frames the task as revising rather than drafting from scratch', () => {
    const p = buildReviseDraftPrompt()
    expect(p).toContain('revise')
    expect(p).toContain("don't drop sections the feedback didn't mention")
  })

  it('holds a revision to the same structured sections', () => {
    const p = buildReviseDraftPrompt()
    expect(p).toContain('## Problem')
    expect(p).toContain('## Acceptance criteria')
  })

  it('weaves in repo context when provided', () => {
    expect(buildReviseDraftPrompt(CONTEXT)).toContain('- Repository: acme/app')
  })
})

describe('buildReviseMessage', () => {
  it('includes the current draft, the feedback, and the original note', () => {
    const msg = buildReviseMessage({
      draft: { title: 'Add a toggle', body: '## Problem\nDark rooms hurt.' },
      feedback: 'Mention keyboard access',
      note: 'dark mode please',
    })
    expect(msg).toContain('Current title: Add a toggle')
    expect(msg).toContain('Dark rooms hurt.')
    expect(msg).toContain('Mention keyboard access')
    expect(msg).toContain('dark mode please')
  })

  it('omits the original-note block when no note is given', () => {
    const msg = buildReviseMessage({
      draft: { title: 'T', body: 'B' },
      feedback: 'F',
    })
    expect(msg).not.toContain('Original note')
  })
})
