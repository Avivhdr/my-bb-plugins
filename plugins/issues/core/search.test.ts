import { describe, it, expect } from 'vitest'
import { buildBoard, emptyHierarchy, type BoardCard } from './board'
import {
  parseQuery,
  matchesCard,
  filterBoard,
  countIssues,
  countMatchingIssues,
  countColumnResults,
  filterBoardByValue,
  isFilterResult,
  cardExcerpt,
  highlightSegments,
} from './search'

const card = (overrides: Partial<BoardCard> = {}): BoardCard => ({
  issueNumber: 1,
  title: 'Refresh token expiry',
  body: 'Retry the auth handshake before the token expires.',
  labels: [],
  value: null,
  threadLink: null,
  ...emptyHierarchy(),
  ...overrides,
})

describe('parseQuery', () => {
  it('lowercases and splits on whitespace', () => {
    expect(parseQuery('Auth  Token')).toEqual(['auth', 'token'])
  })

  it('returns an empty list for blank input', () => {
    expect(parseQuery('   ')).toEqual([])
    expect(parseQuery('')).toEqual([])
  })

  it('deduplicates repeated words', () => {
    expect(parseQuery('auth auth Auth')).toEqual(['auth'])
  })

  it('collapses runs of whitespace, including tabs and newlines', () => {
    expect(parseQuery('auth\t\ntoken')).toEqual(['auth', 'token'])
  })
})

describe('matchesCard', () => {
  it('matches on a title-only term', () => {
    expect(matchesCard(card({ title: 'Refresh token expiry' }), ['token'])).toBe(true)
  })

  it('matches on a body-only term', () => {
    expect(matchesCard(card({ title: 'Refresh token expiry' }), ['handshake'])).toBe(true)
  })

  it('matches the issue number as a bare numeric term', () => {
    expect(matchesCard(card({ issueNumber: 241 }), ['241'])).toBe(true)
    expect(matchesCard(card({ issueNumber: 241 }), ['24'])).toBe(false)
  })

  it('requires every term to hit, in any order across title/body', () => {
    const c = card({ title: 'Add SSO auth provider', body: 'Handles the token exchange.' })
    expect(matchesCard(c, ['auth', 'token'])).toBe(true)
    expect(matchesCard(c, ['token', 'auth'])).toBe(true)
  })

  it('fails when one term is missing entirely', () => {
    const c = card({ title: 'auth docs are stale', body: null })
    expect(matchesCard(c, ['auth', 'token'])).toBe(false)
  })

  it('treats a null body as never matching a body-only term', () => {
    expect(matchesCard(card({ title: 'plain title', body: null }), ['handshake'])).toBe(false)
  })

  // Terms are already lowercased by parseQuery; matchesCard only needs to lowercase
  // the card's own text to compare against them.
  it('is case-insensitive', () => {
    expect(matchesCard(card({ title: 'Refresh Token Expiry' }), ['refresh'])).toBe(true)
  })
})

describe('filterBoard', () => {
  const board = () =>
    buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 'Refresh token expiry', body: 'auth handshake', labels: ['bug'] },
        { number: 2, title: 'Add SSO auth provider', body: 'token exchange', labels: ['bug', 'feature'] },
        { number: 3, title: 'Improve onboarding copy', body: null, labels: ['feature'] },
        { number: 4, title: 'auth docs are stale', body: null, labels: [] },
      ],
      columnLabels: ['bug', 'feature'],
      values: {},
    })

  it('returns the board unchanged when there are no terms', () => {
    const b = board()
    expect(filterBoard(b, [])).toBe(b)
  })

  it('drops non-matching cards from every column', () => {
    const out = filterBoard(board(), ['auth', 'token'])
    const bug = out.columns.find((c) => c.label === 'bug')!
    expect(bug.cards.map((c) => c.issueNumber)).toEqual([2, 1])
  })

  it('removes a column left with zero matches, including Other', () => {
    const out = filterBoard(board(), ['onboarding'])
    expect(out.columns.map((c) => c.label)).toEqual(['feature'])
  })

  it('keeps a multi-label card in every column it matches through', () => {
    const out = filterBoard(board(), ['auth', 'token'])
    expect(out.columns.map((c) => c.label)).toEqual(['bug', 'feature'])
    expect(out.columns.find((c) => c.label === 'feature')!.cards.map((c) => c.issueNumber)).toEqual([2])
  })

  it('does not mutate the source board', () => {
    const b = board()
    const before = JSON.stringify(b)
    filterBoard(b, ['auth'])
    expect(JSON.stringify(b)).toBe(before)
  })
})

describe('countIssues', () => {
  it('counts a multi-label card once, not once per column', () => {
    const board = buildBoard({
      repo: 'a/b',
      issues: [{ number: 1, title: 't', body: null, labels: ['bug', 'feature'] }],
      columnLabels: ['bug', 'feature'],
      values: {},
    })
    expect(countIssues(board)).toBe(1)
  })

  it('sums distinct issues across columns', () => {
    const board = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 't', body: null, labels: ['bug'] },
        { number: 2, title: 't', body: null, labels: ['feature'] },
      ],
      columnLabels: ['bug', 'feature'],
      values: {},
    })
    expect(countIssues(board)).toBe(2)
  })

  it('returns 0 for an empty board', () => {
    expect(countIssues(buildBoard({ repo: 'a/b', issues: [], columnLabels: [], values: {} }))).toBe(0)
  })

  it('counts nested sub-issues as distinct issues', () => {
    const board = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 'parent', body: null, labels: ['bug'] },
        { number: 2, title: 'child', body: null, labels: ['bug'], parentIssueNumber: 1 },
      ],
      columnLabels: ['bug'],
      values: {},
    })
    expect(countIssues(board)).toBe(2)
  })
})

describe('filterBoard nested sub-issues', () => {
  const board = () =>
    buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Blocked By field', body: null, labels: ['bug'] },
        { number: 506, title: 'item a', body: 'child work', labels: ['bug'], parentIssueNumber: 35 },
        { number: 11, title: 'Unrelated crash', body: null, labels: ['bug'] },
      ],
      columnLabels: ['bug'],
      values: {},
    })

  it('keeps the parent group when only a nested sub-issue matches', () => {
    const out = filterBoard(board(), ['item'])
    const cards = out.columns[0]!.cards
    expect(cards.map((c) => c.issueNumber)).toEqual([35])
    expect(cards[0]!.subIssues.map((c) => c.issueNumber)).toEqual([506])
  })

  it('does not count a context-only parent as a match', () => {
    expect(countMatchingIssues(board(), ['item'])).toBe(1)
  })

  it('keeps the full subtree when the parent matches', () => {
    const out = filterBoard(board(), ['blocked'])
    expect(out.columns[0]!.cards[0]!.subIssues.map((c) => c.issueNumber)).toEqual([506])
  })
})

describe('countColumnResults', () => {
  const board = () =>
    buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Blocked By field', body: null, labels: ['bug'] },
        { number: 506, title: 'item a', body: 'child work', labels: ['bug'], parentIssueNumber: 35 },
        { number: 11, title: 'Unrelated crash', body: null, labels: ['bug'] },
      ],
      columnLabels: ['bug'],
      values: { 11: 3 },
    })
  const noValues = new Set<number | 'none'>()

  it('counts every issue in the column, sub-issues included, with no filter', () => {
    expect(countColumnResults(board().columns[0]!.cards)).toBe(3)
  })

  it('counts search matches only, not the parent kept as context', () => {
    const cards = filterBoard(board(), ['item']).columns[0]!.cards
    expect(countColumnResults(cards, (c) => isFilterResult(c, ['item'], noValues))).toBe(1)
  })

  it('counts value filter matches only, not the parent kept as context', () => {
    const selected = new Set<number | 'none'>([3])
    const cards = filterBoardByValue(board(), selected).columns[0]!.cards
    expect(countColumnResults(cards, (c) => isFilterResult(c, [], selected))).toBe(1)
  })

  it('needs a card to pass both search and the value filter', () => {
    const selected = new Set<number | 'none'>(['none'])
    const cards = board().columns[0]!.cards
    expect(countColumnResults(cards, (c) => isFilterResult(c, ['crash'], selected))).toBe(0)
    expect(countColumnResults(cards, (c) => isFilterResult(c, ['item'], selected))).toBe(1)
  })
})

describe('cardExcerpt', () => {
  it('returns null when the title alone already contains every term', () => {
    expect(cardExcerpt(card({ title: 'auth token issue', body: 'unrelated body text' }), ['auth', 'token'])).toBeNull()
  })

  it('returns null for a null body', () => {
    expect(cardExcerpt(card({ title: 'plain', body: null }), ['auth'])).toBeNull()
  })

  it('returns null when there are no terms', () => {
    expect(cardExcerpt(card(), [])).toBeNull()
  })

  it('returns an excerpt around the first body match, ellipsed on both sides', () => {
    const body =
      'This is a long description that goes on for a good while before it finally mentions the auth handshake and then keeps going on for a good while after that too.'
    const excerpt = cardExcerpt(card({ title: 'Unrelated title', body }), ['auth'])
    expect(excerpt).not.toBeNull()
    expect(excerpt!.startsWith('…')).toBe(true)
    expect(excerpt!.endsWith('…')).toBe(true)
    expect(excerpt!.toLowerCase()).toContain('auth')
  })

  it('omits the leading ellipsis when the match is at the very start', () => {
    const excerpt = cardExcerpt(card({ title: 'Unrelated', body: 'auth is the first word here and nothing else' }), [
      'auth',
    ])
    expect(excerpt!.startsWith('…')).toBe(false)
  })

  it('omits the trailing ellipsis when the match runs to the end', () => {
    const body = 'short body ending in auth'
    const excerpt = cardExcerpt(card({ title: 'Unrelated', body }), ['auth'])
    expect(excerpt!.endsWith('…')).toBe(false)
  })

  it('collapses internal whitespace before excerpting', () => {
    const body = 'line one\n\n   line two mentions   auth   here'
    const excerpt = cardExcerpt(card({ title: 'Unrelated', body }), ['auth'])
    expect(excerpt).not.toMatch(/\s{2,}/)
  })
})

describe('highlightSegments', () => {
  it('returns one unmatched segment when there are no terms', () => {
    expect(highlightSegments('hello world', [])).toEqual([{ text: 'hello world', match: false }])
  })

  it('marks a single matched run', () => {
    expect(highlightSegments('auth token', ['token'])).toEqual([
      { text: 'auth ', match: false },
      { text: 'token', match: true },
    ])
  })

  it('coalesces overlapping term matches into one run', () => {
    const segments = highlightSegments('authentication flow', ['auth', 'authentication'])
    expect(segments).toEqual([
      { text: 'authentication', match: true },
      { text: ' flow', match: false },
    ])
  })

  it('matches a term at the very start and end of the string', () => {
    expect(highlightSegments('auth', ['auth'])).toEqual([{ text: 'auth', match: true }])
  })

  it('is case-insensitive while preserving original casing in output', () => {
    expect(highlightSegments('Auth Token', ['auth'])).toEqual([
      { text: 'Auth', match: true },
      { text: ' Token', match: false },
    ])
  })
})
