import { describe, expect, it } from 'vitest'
import { emptyHierarchy, type BoardCard, type IssueRelation } from './board'
import { arrowsBetween, dependencyArrowPath, dependencyEdges, peerIssueNumbers, type CardBox } from './dependencyArrows'

function relation(number: number, repo = 'a/b'): IssueRelation {
  return {
    number,
    title: `Issue ${number}`,
    htmlUrl: `https://github.com/${repo}/issues/${number}`,
    state: 'open',
    repo,
  }
}

function card(issueNumber: number, overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    issueNumber,
    title: `Issue ${issueNumber}`,
    body: null,
    labels: ['bug'],
    value: null,
    threadLink: null,
    ...emptyHierarchy(),
    ...overrides,
  }
}

describe('dependencyEdges', () => {
  it('draws one edge from the blocker to the blocked issue and ignores the reverse copy', () => {
    const cards = [
      card(10, { blockedBy: [relation(12)], blockedByOpenCount: 1 }),
      card(12, { blocking: [relation(10)], blockingOpenCount: 1 }),
    ]
    expect(dependencyEdges(cards, 'a/b', new Set([10, 12]))).toEqual([{ blocker: 12, blocked: 10 }])
  })

  it('skips issues that are not on this board and issues in another repository', () => {
    const cards = [
      card(10, {
        blockedBy: [relation(12), relation(8, 'other/repo'), { ...relation(4), state: 'closed' }],
        blockedByOpenCount: 2,
      }),
    ]
    expect(dependencyEdges(cards, 'a/b', new Set([10]))).toEqual([])
  })

  it('names the other end of a focused issue', () => {
    const edges = [
      { blocker: 12, blocked: 10 },
      { blocker: 10, blocked: 11 },
    ]
    expect(peerIssueNumbers(edges, 10).sort()).toEqual([11, 12])
  })
})

describe('dependency arrow paths', () => {
  const blocker: CardBox = { issueNumber: 12, x: 0, y: 0, w: 100, h: 40 }
  const blocked: CardBox = { issueNumber: 10, x: 320, y: 80, w: 100, h: 40 }

  it('uses a rounded curve that stops before the blocked card', () => {
    const [arrow] = arrowsBetween([{ blocker: 12, blocked: 10 }], [blocker, blocked])
    expect(arrow?.d.startsWith('M ')).toBe(true)
    expect(arrow?.d).toContain(' C ')
    const end = arrow?.d.split(' ').slice(-2).map(Number)
    expect(end?.[0]).toBeLessThan(blocked.x)
    expect(end?.[0]).toBeGreaterThan(blocker.x + blocker.w)
  })

  it('still curves when the cards are stacked in one column', () => {
    const path = dependencyArrowPath({ x1: 50, y1: 40, x2: 50, y2: 120 })
    expect(path).toContain(' C ')
    expect(path).toContain('50 120')
  })
})
