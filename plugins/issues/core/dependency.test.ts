import { describe, expect, it } from 'vitest'
import { buildBoard, type IssueRelation } from './board'
import { filterBoardByDependency, relationLabel, relationWindow } from './dependency'

function relation(number: number, repo = 'a/b'): IssueRelation {
  return {
    number,
    title: `Issue ${number}`,
    htmlUrl: `https://github.com/${repo}/issues/${number}`,
    state: 'open',
    repo,
  }
}

function board() {
  return buildBoard({
    repo: 'a/b',
    issues: [
      { number: 1, title: 'Parent, not blocked', body: null, labels: ['bug'] },
      {
        number: 2,
        title: 'Child blocked by the schema',
        body: null,
        labels: ['bug'],
        parentIssueNumber: 1,
        blockedBy: [relation(9)],
        blockedByOpenCount: 1,
      },
      { number: 3, title: 'Ready sibling', body: null, labels: ['bug'] },
      {
        number: 4,
        title: 'Feature that blocks other work',
        body: null,
        labels: ['feature'],
        blocking: [relation(3)],
        blockingOpenCount: 1,
      },
      {
        number: 5,
        title: 'Blocked feature',
        body: null,
        labels: ['feature'],
        blockedBy: [relation(4)],
        blockedByOpenCount: 1,
      },
    ],
    columnLabels: ['bug', 'feature'],
    values: {},
  })
}

describe('filterBoardByDependency', () => {
  it('returns the same board when the mode is all', () => {
    const source = board()
    expect(filterBoardByDependency(source, 'all')).toBe(source)
  })

  it('shows only issues that have an open blocker', () => {
    const out = filterBoardByDependency(board(), 'blocked')
    expect(out.columns.map((column) => column.label)).toEqual(['bug', 'feature'])
    expect(out.columns.find((column) => column.label === 'bug')!.cards.map((card) => card.issueNumber)).toEqual([2])
    expect(out.columns.find((column) => column.label === 'feature')!.cards.map((card) => card.issueNumber)).toEqual([5])
  })

  it('shows only issues that block other open work', () => {
    const out = filterBoardByDependency(board(), 'blocking')
    expect(out.columns.map((column) => column.label)).toEqual(['feature'])
    expect(out.columns[0]!.cards.map((card) => card.issueNumber)).toEqual([4])
  })

  it('shows issues that are not blocked, including issues that block other work', () => {
    const out = filterBoardByDependency(board(), 'unblocked')
    const bug = out.columns.find((column) => column.label === 'bug')!
    expect(bug.cards.map((card) => card.issueNumber)).toEqual([3, 1])
    expect(bug.cards.find((card) => card.issueNumber === 1)!.subIssues).toEqual([])
    expect(out.columns.find((column) => column.label === 'feature')!.cards.map((card) => card.issueNumber)).toEqual([4])
  })

  it('promotes a matching nested issue when its parent is hidden', () => {
    const promoted = filterBoardByDependency(board(), 'blocked').columns.find((column) => column.label === 'bug')!
      .cards[0]!
    expect(promoted.issueNumber).toBe(2)
    expect(promoted.blockedByOpenCount).toBe(1)
  })

  it('does not mutate the source board', () => {
    const source = board()
    const before = JSON.stringify(source)
    filterBoardByDependency(source, 'blocked')
    filterBoardByDependency(source, 'unblocked')
    expect(JSON.stringify(source)).toBe(before)
  })
})

describe('relation labels', () => {
  it('uses the issue number for the board repository and the full name otherwise', () => {
    expect(relationLabel(relation(12, 'a/b'), 'a/b')).toBe('#12')
    expect(relationLabel(relation(12, 'other/repo'), 'A/B')).toBe('other/repo#12')
  })

  it('keeps the first relations and counts the rest, including ones past the fetched list', () => {
    const relations = [relation(1), relation(2), relation(3)]
    expect(relationWindow(relations, 5)).toEqual({ shown: [relation(1), relation(2)], extra: 3 })
  })
})
