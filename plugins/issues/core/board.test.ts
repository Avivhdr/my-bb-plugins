import { describe, it, expect } from 'vitest'
import {
  buildBoard,
  placeCards,
  sortColumnCards,
  applyCreate,
  applyRename,
  applyRelabel,
  flattenCards,
  groupSubIssues,
  OTHER_TITLE,
  emptyHierarchy,
  type BoardCard,
} from './board'

const card = (n: number, labels: string[], value: number | null = null): BoardCard => ({
  issueNumber: n,
  title: `#${n}`,
  body: null,
  labels,
  value,
  threadLink: null,
  ...emptyHierarchy(),
})

describe('placeCards', () => {
  it('creates one column per curated label, in order, plus Other last', () => {
    const cols = placeCards([], ['bug', 'enhancement'])
    expect(cols.map((c) => c.label)).toEqual(['bug', 'enhancement', ''])
    expect(cols.map((c) => c.isOther)).toEqual([false, false, true])
    expect(cols[2].title).toBe(OTHER_TITLE)
  })

  it("attaches each label's color, leaving unknown labels and Other colorless", () => {
    const cols = placeCards([], ['bug', 'enhancement'], { bug: 'd73a4a' })
    expect(cols[0].color).toBe('d73a4a') // bug — known color
    expect(cols[1].color).toBeNull() // enhancement — no color provided
    expect(cols[2].color).toBeNull() // Other — never colored
  })

  it('places a card in every curated column whose label it has (multi-label)', () => {
    const cols = placeCards([card(1, ['bug', 'enhancement'])], ['bug', 'enhancement'])
    expect(cols[0].cards.map((c) => c.issueNumber)).toEqual([1]) // bug
    expect(cols[1].cards.map((c) => c.issueNumber)).toEqual([1]) // enhancement
    expect(cols[2].cards).toEqual([]) // Other
  })

  it('sends unlabeled cards and cards with only non-curated labels to Other', () => {
    const cols = placeCards([card(1, []), card(2, ['wontfix'])], ['bug'])
    expect(cols[0].cards).toEqual([]) // bug
    expect(cols[1].cards.map((c) => c.issueNumber)).toEqual([1, 2]) // Other
  })

  it('empty columnLabels yields only the Other column', () => {
    const cols = placeCards([card(1, ['bug']), card(2, [])], [])
    expect(cols).toHaveLength(1)
    expect(cols[0].isOther).toBe(true)
    expect(cols[0].cards.map((c) => c.issueNumber)).toEqual([1, 2])
  })
})

describe('sortColumnCards', () => {
  it('sorts by value desc then issue number desc', () => {
    const out = sortColumnCards([card(1, [], 5), card(2, [], 9), card(3, [], 5)])
    expect(out.map((c) => c.issueNumber)).toEqual([2, 3, 1])
  })

  it('puts unscored (null) cards last', () => {
    const out = sortColumnCards([card(1, [], null), card(2, [], 3)])
    expect(out.map((c) => c.issueNumber)).toEqual([2, 1])
  })

  it('two null-value cards are ordered by issueNumber descending', () => {
    const out = sortColumnCards([card(3, [], null), card(7, [], null)])
    expect(out.map((c) => c.issueNumber)).toEqual([7, 3])
  })

  it('does not mutate its input array', () => {
    const input = [card(1, [], 1), card(2, [], 9)]
    const snapshot = input.map((c) => c.issueNumber)
    sortColumnCards(input)
    expect(input.map((c) => c.issueNumber)).toEqual(snapshot)
  })
})

describe('buildBoard', () => {
  it('folds issues and values into a board model, sorting value desc then number desc', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 10, title: 'A', body: null, labels: ['bug'] },
        { number: 11, title: 'B', body: null, labels: ['bug'] },
        { number: 12, title: 'C', body: null, labels: [] },
      ],
      columnLabels: ['bug'],
      values: { 10: 9, 11: 3 },
    })

    const bug = model.columns.find((c) => c.label === 'bug')!
    expect(bug.cards.map((c) => c.issueNumber)).toEqual([10, 11]) // value 9 before 3

    const other = model.columns.find((c) => c.isOther)!
    expect(other.cards.map((c) => c.issueNumber)).toEqual([12])
    expect(other.cards[0].value).toBeNull()
  })

  it('tints a column with its label color and leaves Other colorless', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 't', body: null, labels: ['bug'] },
        { number: 2, title: 't', body: null, labels: [] },
      ],
      columnLabels: ['bug'],
      labelColors: { bug: 'd73a4a' },
      values: {},
    })
    expect(model.columns.find((c) => c.label === 'bug')!.color).toBe('d73a4a')
    expect(model.columns.find((c) => c.isOther)!.color).toBeNull()
  })

  it('exposes the repo on the model', () => {
    const model = buildBoard({ repo: 'octo/cat', issues: [], columnLabels: [], values: {} })
    expect(model.repo).toBe('octo/cat')
  })

  it('attaches thread links to matching issue cards', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 'linked', body: null, labels: ['bug'] },
        { number: 2, title: 'plain', body: null, labels: ['bug'] },
      ],
      columnLabels: ['bug'],
      values: {},
      threadLinks: {
        1: { threadId: 'thr_9', title: 'linked' },
      },
    })

    const cards = model.columns.find((c) => c.label === 'bug')!.cards
    expect(cards.find((c) => c.issueNumber === 1)!.threadLink).toEqual({
      threadId: 'thr_9',
      title: 'linked',
    })
    expect(cards.find((c) => c.issueNumber === 2)!.threadLink).toBeNull()
  })

  it('attaches linked pull requests to matching issue cards', () => {
    const linked = {
      number: 99,
      title: 'Fix hydrate',
      htmlUrl: 'https://github.com/a/b/pull/99',
      state: 'open',
    }
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 'linked', body: null, labels: ['bug'], linkedPullRequests: [linked] },
        { number: 2, title: 'plain', body: null, labels: ['bug'] },
      ],
      columnLabels: ['bug'],
      values: {},
    })

    const cards = model.columns.find((c) => c.label === 'bug')!.cards
    expect(cards.find((c) => c.issueNumber === 1)!.linkedPullRequests).toEqual([linked])
    expect(cards.find((c) => c.issueNumber === 2)!.linkedPullRequests).toEqual([])
  })
})

describe('applyCreate', () => {
  const board = () =>
    buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: '#1', body: null, labels: ['bug'] },
        { number: 2, title: '#2', body: null, labels: ['bug'] },
        { number: 3, title: '#3', body: null, labels: ['enh'] },
        { number: 4, title: '#4', body: null, labels: [] },
      ],
      columnLabels: ['bug', 'enh'],
      values: {},
    })

  it('inserts a new card at the top of its labelled column', () => {
    const out = applyCreate(board(), card(9, ['bug']))
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toEqual([9, 2, 1])
    expect(out.columns[1].cards.map((c) => c.issueNumber)).toEqual([3]) // others untouched
  })

  it('inserts a multi-label card into every matching column', () => {
    const out = applyCreate(board(), card(9, ['bug', 'enh']))
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toEqual([9, 2, 1])
    expect(out.columns[1].cards.map((c) => c.issueNumber)).toEqual([9, 3])
  })

  it('routes a card with no curated label into Other', () => {
    const out = applyCreate(board(), card(9, []))
    const other = out.columns.find((c) => c.isOther)!
    expect(other.cards.map((c) => c.issueNumber)).toEqual([9, 4])
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toEqual([2, 1])
  })

  it('is idempotent — a card already present is not duplicated', () => {
    const out = applyCreate(board(), card(1, ['bug']))
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toEqual([2, 1])
  })
})

describe('applyRename', () => {
  const board = () =>
    buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: '#1', body: null, labels: ['bug'] },
        { number: 3, title: '#3', body: null, labels: ['enh'] },
      ],
      columnLabels: ['bug', 'enh'],
      values: {},
    })

  it('updates the title of the matching card across columns', () => {
    const out = applyRename(board(), 3, 'renamed')
    expect(out.columns[1].cards[0].title).toBe('renamed')
    expect(out.columns[0].cards[0].title).toBe('#1') // others untouched
  })
})

describe('groupSubIssues', () => {
  it('nests a child under its parent and keeps the parent as the only root', () => {
    const parent = { ...card(35, ['bug']), title: 'Parent' }
    const child = { ...card(506, ['bug']), parentIssueNumber: 35, title: 'item a' }

    const roots = groupSubIssues([parent, child])

    expect(roots.map((c) => c.issueNumber)).toEqual([35])
    expect(roots[0]!.subIssues.map((c) => c.issueNumber)).toEqual([506])
  })

  it('keeps a child as a root when its parent is not on the board', () => {
    const child = { ...card(506, ['bug']), parentIssueNumber: 35 }
    expect(groupSubIssues([child]).map((c) => c.issueNumber)).toEqual([506])
  })

  it('nests grandchildren under their parent', () => {
    const root = { ...card(1, []), title: 'root' }
    const mid = { ...card(2, []), parentIssueNumber: 1, title: 'mid' }
    const leaf = { ...card(3, []), parentIssueNumber: 2, title: 'leaf' }

    const roots = groupSubIssues([leaf, mid, root])

    expect(roots.map((c) => c.issueNumber)).toEqual([1])
    expect(roots[0]!.subIssues.map((c) => c.issueNumber)).toEqual([2])
    expect(roots[0]!.subIssues[0]!.subIssues.map((c) => c.issueNumber)).toEqual([3])
  })

  it('does not nest a cyclic parent link', () => {
    const a = { ...card(1, []), parentIssueNumber: 2 }
    const b = { ...card(2, []), parentIssueNumber: 1 }

    const roots = groupSubIssues([a, b])

    expect(roots.map((c) => c.issueNumber).sort()).toEqual([1, 2])
    expect(roots.flatMap((c) => c.subIssues)).toEqual([])
  })
})

describe('buildBoard grouping', () => {
  it('nests a sub-issue under its parent only in a column they share', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Parent', body: null, labels: ['bug'] },
        {
          number: 506,
          title: 'item a',
          body: null,
          labels: ['bug'],
          parentIssueNumber: 35,
        },
      ],
      columnLabels: ['bug', 'enhancement'],
      values: {},
    })

    const bug = model.columns.find((c) => c.label === 'bug')!
    expect(bug.cards.map((c) => c.issueNumber)).toEqual([35])
    expect(bug.cards[0]!.subIssues.map((c) => c.issueNumber)).toEqual([506])

    const enhancement = model.columns.find((c) => c.label === 'enhancement')!
    expect(enhancement.cards.map((c) => c.issueNumber)).toEqual([])
  })

  it('keeps a differently labelled sub-issue in its own column, not under the parent', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Parent', body: null, labels: ['bug'] },
        {
          number: 506,
          title: 'item a',
          body: null,
          labels: ['enhancement'],
          parentIssueNumber: 35,
        },
      ],
      columnLabels: ['bug', 'enhancement'],
      values: {},
    })

    const bug = model.columns.find((c) => c.label === 'bug')!
    expect(bug.cards.map((c) => c.issueNumber)).toEqual([35])
    expect(bug.cards[0]!.subIssues).toEqual([])

    const enhancement = model.columns.find((c) => c.label === 'enhancement')!
    expect(enhancement.cards.map((c) => c.issueNumber)).toEqual([506])
    expect(enhancement.cards[0]).toMatchObject({ issueNumber: 506, parentIssueNumber: 35 })
    expect(enhancement.cards[0]!.subIssues).toEqual([])
  })

  it('nests a child in the shared column and also shows it where the parent is absent', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Parent', body: null, labels: ['bug'] },
        {
          number: 506,
          title: 'item a',
          body: null,
          labels: ['bug', 'enhancement'],
          parentIssueNumber: 35,
        },
      ],
      columnLabels: ['bug', 'enhancement'],
      values: {},
    })

    const bug = model.columns.find((c) => c.label === 'bug')!
    expect(bug.cards.map((c) => c.issueNumber)).toEqual([35])
    expect(bug.cards[0]!.subIssues.map((c) => c.issueNumber)).toEqual([506])

    const enhancement = model.columns.find((c) => c.label === 'enhancement')!
    expect(enhancement.cards.map((c) => c.issueNumber)).toEqual([506])
    expect(enhancement.cards[0]!.parentIssueNumber).toBe(35)
  })

  it('sorts nested sub-issues by value then number, matching column sort', () => {
    const model = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: 'Parent', body: null, labels: ['bug'] },
        { number: 3, title: 'low', body: null, labels: ['bug'], parentIssueNumber: 1 },
        { number: 2, title: 'high', body: null, labels: ['bug'], parentIssueNumber: 1 },
      ],
      columnLabels: ['bug'],
      values: { 2: 9, 3: 2 },
    })

    expect(model.columns[0]!.cards[0]!.subIssues.map((c) => c.issueNumber)).toEqual([2, 3])
  })
})

describe('flattenCards', () => {
  it('walks parent then descendants in depth-first order', () => {
    const leaf = { ...card(3, []), parentIssueNumber: 2 }
    const mid = { ...card(2, []), parentIssueNumber: 1, subIssues: [leaf] }
    const root = { ...card(1, []), subIssues: [mid] }

    expect(flattenCards([root]).map((c) => c.issueNumber)).toEqual([1, 2, 3])
  })
})

describe('applyRelabel', () => {
  const board = () =>
    buildBoard({
      repo: 'a/b',
      issues: [
        { number: 1, title: '#1', body: null, labels: ['bug'] },
        { number: 2, title: '#2', body: null, labels: ['bug'] },
        { number: 3, title: '#3', body: null, labels: ['enh'] },
        { number: 4, title: '#4', body: null, labels: [] },
      ],
      columnLabels: ['bug', 'enh'],
      values: {},
    })

  it('moves a card to another column and swaps its label', () => {
    const out = applyRelabel(board(), 1, 'bug', 'enh')
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toEqual([2]) // left bug
    expect(out.columns[1].cards.map((c) => c.issueNumber)).toContain(1) // joined enh
    expect(out.columns[1].cards.find((c) => c.issueNumber === 1)!.labels).toEqual(['enh'])
  })

  it('dropping into Other (empty toLabel) removes the curated label', () => {
    const out = applyRelabel(board(), 1, 'bug', '')
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toEqual([2])
    const other = out.columns.find((c) => c.isOther)!
    expect(other.cards.map((c) => c.issueNumber)).toContain(1)
    expect(other.cards.find((c) => c.issueNumber === 1)!.labels).toEqual([])
  })

  it('adding a curated label keeps the card in its existing columns too (multi-label)', () => {
    const out = applyRelabel(board(), 1, '', 'enh')
    expect(out.columns[0].cards.map((c) => c.issueNumber)).toContain(1) // still bug
    expect(out.columns[1].cards.map((c) => c.issueNumber)).toContain(1) // now also enh
    expect(out.columns[1].cards.find((c) => c.issueNumber === 1)!.labels).toEqual(['bug', 'enh'])
  })

  it('moves a nested sub-issue to its own column when it no longer shares the parent label', () => {
    const grouped = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Parent', body: null, labels: ['bug'] },
        { number: 506, title: 'item a', body: null, labels: ['bug'], parentIssueNumber: 35 },
      ],
      columnLabels: ['bug', 'enh'],
      values: {},
    })

    const out = applyRelabel(grouped, 506, 'bug', 'enh')
    expect(out.columns[0]!.cards.map((c) => c.issueNumber)).toEqual([35])
    expect(out.columns[0]!.cards[0]!.subIssues).toEqual([])
    expect(out.columns[1]!.cards.map((c) => c.issueNumber)).toEqual([506])
    expect(out.columns[1]!.cards[0]).toMatchObject({
      issueNumber: 506,
      labels: ['enh'],
      parentIssueNumber: 35,
    })
  })
})

describe('applyRename nested', () => {
  it('renames a nested sub-issue under its parent', () => {
    const grouped = buildBoard({
      repo: 'a/b',
      issues: [
        { number: 35, title: 'Parent', body: null, labels: ['bug'] },
        { number: 506, title: 'item a', body: null, labels: ['bug'], parentIssueNumber: 35 },
      ],
      columnLabels: ['bug'],
      values: {},
    })

    const out = applyRename(grouped, 506, 'item a renamed')
    expect(out.columns[0]!.cards[0]!.subIssues[0]!.title).toBe('item a renamed')
  })
})
