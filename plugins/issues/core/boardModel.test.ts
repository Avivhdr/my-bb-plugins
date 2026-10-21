import { describe, expect, it } from 'vitest'
import { emptyHierarchy, type BoardCard, type IssueThreadLink } from './board'
import {
  mapSubIssuesSummary,
  modelFromIssuesBoard,
  patchBoardCardValue,
  patchBoardLabelColor,
  reconcilePendingCreatedCards,
} from './boardModel'
import type { IssuesBoard } from './types'

const rawBoard: IssuesBoard = {
  repo: { owner: 'octo', name: 'cat' },
  issues: [
    {
      number: 7,
      title: 'Hydrate me',
      body: 'Body',
      state: 'open',
      html_url: 'https://github.com/octo/cat/issues/7',
      labels: [{ name: 'alpha', color: 'ff0000' }],
    },
  ],
  labels: [{ name: 'alpha', color: 'ff0000' }],
  values: { '7': 8 },
  columnLabels: ['alpha'],
}

const threadLink: IssueThreadLink = {
  threadId: 'thr_7',
  title: 'Hydrate me',
}

const pendingCard: BoardCard = {
  issueNumber: 9,
  title: 'Eventually consistent',
  body: '',
  labels: [],
  value: null,
  threadLink: null,
  ...emptyHierarchy(),
}

describe('board model', () => {
  it('maps a GitHub sub-issues summary and ignores an empty rollup', () => {
    expect(mapSubIssuesSummary({ total: 4, completed: 1, percent_completed: 25 })).toEqual({
      total: 4,
      completed: 1,
      percentCompleted: 25,
    })
    expect(mapSubIssuesSummary({ total: 0, completed: 0, percent_completed: 0 })).toBeNull()
    expect(mapSubIssuesSummary(null)).toBeNull()
  })

  it('hydrates backend wire data and thread links into the board model', () => {
    const model = modelFromIssuesBoard({ ...rawBoard, threadLinks: { '7': threadLink } })

    expect(model.repo).toBe('octo/cat')
    expect(model.columns[0]?.color).toBe('ff0000')
    expect(model.columns[0]?.cards[0]).toMatchObject({
      issueNumber: 7,
      value: 8,
      threadLink,
    })
  })

  it('keeps pending created cards until the backend listing catches up', () => {
    const model = modelFromIssuesBoard(rawBoard)

    const stale = reconcilePendingCreatedCards(model, rawBoard, [pendingCard])
    expect(stale.pendingCards).toEqual([pendingCard])
    expect(stale.board.columns.at(-1)?.cards.map((card) => card.issueNumber)).toContain(9)

    const caughtUpRaw: IssuesBoard = {
      ...rawBoard,
      issues: [
        ...rawBoard.issues,
        {
          number: 9,
          title: pendingCard.title,
          body: pendingCard.body,
          state: 'open',
          html_url: 'https://github.com/octo/cat/issues/9',
          labels: [],
        },
      ],
    }
    const caughtUp = reconcilePendingCreatedCards(
      modelFromIssuesBoard(caughtUpRaw),
      caughtUpRaw,
      stale.pendingCards,
    )

    expect(caughtUp.pendingCards).toEqual([])
    expect(caughtUp.board.columns.at(-1)?.cards.filter((card) => card.issueNumber === 9)).toHaveLength(1)
  })

  it('applies optimistic value and label-color patches immutably', () => {
    const model = modelFromIssuesBoard(rawBoard)
    const valued = patchBoardCardValue(model, 7, 4)
    const recolored = patchBoardLabelColor(valued, 'alpha', 'abcdef')

    expect(recolored.columns[0]?.cards[0]?.value).toBe(4)
    expect(recolored.columns[0]?.color).toBe('abcdef')
    expect(model.columns[0]?.cards[0]?.value).toBe(8)
    expect(model.columns[0]?.color).toBe('ff0000')
  })

  it('nests GitHub sub-issues under the parent on the same board', () => {
    const grouped = modelFromIssuesBoard({
      ...rawBoard,
      issues: [
        rawBoard.issues[0]!,
        {
          number: 8,
          title: 'Child',
          body: null,
          state: 'open',
          html_url: 'https://github.com/octo/cat/issues/8',
          labels: [{ name: 'alpha', color: 'ff0000' }],
          parent_issue_url: 'https://api.github.com/repos/octo/cat/issues/7',
          sub_issues_summary: null,
        },
      ],
    })

    expect(grouped.columns[0]?.cards.map((card) => card.issueNumber)).toEqual([7])
    expect(grouped.columns[0]?.cards[0]?.subIssues.map((card) => card.issueNumber)).toEqual([8])
  })

  it('attaches linked pull requests from the backend wire data', () => {
    const model = modelFromIssuesBoard({
      ...rawBoard,
      issues: [
        {
          ...rawBoard.issues[0]!,
          linked_pull_requests: [
            {
              number: 99,
              title: 'Fix hydrate',
              html_url: 'https://github.com/octo/cat/pull/99',
              state: 'open',
            },
          ],
        },
      ],
    })

    expect(model.columns[0]?.cards[0]?.linkedPullRequests).toEqual([
      {
        number: 99,
        title: 'Fix hydrate',
        htmlUrl: 'https://github.com/octo/cat/pull/99',
        state: 'open',
      },
    ])
  })
})
