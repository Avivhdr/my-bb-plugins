import {
  applyCreate,
  buildBoard,
  mapCardTree,
  type BoardCard,
  type BoardModel,
  type IssueThreadLink,
  type SubIssuesSummary,
} from './board'
import { parentIssueNumberFromUrl } from './github/parentIssue'
import type { IssuesBoard, SubIssuesSummaryRaw } from './types'

export function mapSubIssuesSummary(
  raw: SubIssuesSummaryRaw | null | undefined,
): SubIssuesSummary | null {
  if (!raw || typeof raw.total !== 'number' || raw.total < 1) return null
  return {
    total: raw.total,
    completed: typeof raw.completed === 'number' ? raw.completed : 0,
    percentCompleted: typeof raw.percent_completed === 'number' ? raw.percent_completed : 0,
  }
}

export interface PendingCardReconciliation {
  board: BoardModel
  pendingCards: BoardCard[]
}

export function modelFromIssuesBoard(raw: IssuesBoard): BoardModel {
  const threadLinks: Record<number, IssueThreadLink> = {}
  for (const [key, link] of Object.entries(raw.threadLinks ?? {})) {
    threadLinks[Number(key)] = link
  }

  const values: Record<number, number> = {}
  for (const [key, value] of Object.entries(raw.values)) {
    values[Number(key)] = value
  }

  const labelColors: Record<string, string> = {}
  for (const label of raw.labels) {
    labelColors[label.name] = label.color
  }

  return buildBoard({
    repo: `${raw.repo.owner}/${raw.repo.name}`,
    issues: raw.issues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((label) => label.name),
      parentIssueNumber: parentIssueNumberFromUrl(issue.parent_issue_url, raw.repo),
      subIssuesSummary: mapSubIssuesSummary(issue.sub_issues_summary),
      linkedPullRequests: (issue.linked_pull_requests ?? []).map((pr) => ({
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.html_url,
        state: pr.state,
      })),
    })),
    columnLabels: raw.columnLabels,
    labelColors,
    values,
    threadLinks,
  })
}

export function reconcilePendingCreatedCards(
  model: BoardModel,
  raw: IssuesBoard,
  pendingCards: BoardCard[],
): PendingCardReconciliation {
  const loadedIssueNumbers = new Set(raw.issues.map((issue) => issue.number))
  const remainingPendingCards = pendingCards.filter(
    (card) => !loadedIssueNumbers.has(card.issueNumber),
  )

  return {
    board: remainingPendingCards.reduce(
      (current, card) => applyCreate(current, card),
      model,
    ),
    pendingCards: remainingPendingCards,
  }
}

export function patchBoardCardValue(
  board: BoardModel,
  issueNumber: number,
  value: number | null,
): BoardModel {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: mapCardTree(column.cards, (card) =>
        card.issueNumber === issueNumber ? { ...card, value } : card,
      ),
    })),
  }
}

export function patchBoardLabelColor(
  board: BoardModel,
  name: string,
  color: string,
): BoardModel {
  return {
    ...board,
    columns: board.columns.map((column) =>
      column.label === name ? { ...column, color } : column,
    ),
  }
}
