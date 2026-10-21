import { describe, expect, it } from 'vitest'
import { buildBoard, type IssueThreadLink } from './board'
import { filterBoardByThreadAssociation } from './threadAssociation'

const link = (threadId: string): IssueThreadLink => ({ threadId, title: null })

function board() {
  return buildBoard({
    repo: 'a/b',
    issues: [
      { number: 1, title: 'Parent with no thread', body: null, labels: ['bug'] },
      { number: 2, title: 'Child with a thread', body: null, labels: ['bug'], parentIssueNumber: 1 },
      { number: 3, title: 'Sibling with no thread', body: null, labels: ['bug'] },
      { number: 4, title: 'Feature with a thread', body: null, labels: ['feature'] },
    ],
    columnLabels: ['bug', 'feature'],
    values: {},
    threadLinks: {
      2: link('thr_2'),
      4: link('thr_4'),
    },
  })
}

describe('filterBoardByThreadAssociation', () => {
  it('returns the same board when the mode is all', () => {
    const source = board()
    expect(filterBoardByThreadAssociation(source, 'all')).toBe(source)
  })

  it('hides issues that have a linked thread and keeps the rest', () => {
    const out = filterBoardByThreadAssociation(board(), 'without')
    const bug = out.columns.find((column) => column.label === 'bug')!
    expect(bug.cards.map((card) => card.issueNumber)).toEqual([3, 1])
    expect(bug.cards.find((card) => card.issueNumber === 1)!.subIssues).toEqual([])
    expect(out.columns.map((column) => column.label)).toEqual(['bug'])
  })

  it('shows only issues that have a linked thread', () => {
    const out = filterBoardByThreadAssociation(board(), 'with')
    expect(out.columns.map((column) => column.label)).toEqual(['bug', 'feature'])
    expect(out.columns.find((column) => column.label === 'bug')!.cards.map((card) => card.issueNumber)).toEqual([2])
    expect(out.columns.find((column) => column.label === 'feature')!.cards.map((card) => card.issueNumber)).toEqual([4])
  })

  it('promotes a matching nested issue when its parent is hidden', () => {
    const out = filterBoardByThreadAssociation(board(), 'with')
    const promoted = out.columns.find((column) => column.label === 'bug')!.cards[0]!
    expect(promoted.issueNumber).toBe(2)
    expect(promoted.threadLink?.threadId).toBe('thr_2')
  })

  it('does not mutate the source board', () => {
    const source = board()
    const before = JSON.stringify(source)
    filterBoardByThreadAssociation(source, 'without')
    filterBoardByThreadAssociation(source, 'with')
    expect(JSON.stringify(source)).toBe(before)
  })
})
