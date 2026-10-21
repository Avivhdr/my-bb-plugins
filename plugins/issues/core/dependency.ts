// Filter an already-loaded board by GitHub issue dependencies.
// An issue is blocked when at least one open issue blocks it. An issue that
// only blocks other work is unblocked. Closed blockers do not count.

import type { BoardCard, BoardColumn, BoardModel, IssueRelation } from './board'

/** All issues, blocked issues, blocking issues, or issues with no open blocker. */
export type DependencyMode = 'all' | 'blocked' | 'blocking' | 'unblocked'

export function sameRepo(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function cardIsBlocked(card: BoardCard): boolean {
  return card.blockedByOpenCount > 0
}

/** True when this issue blocks at least one open issue. */
export function cardIsBlocking(card: BoardCard): boolean {
  return card.blockingOpenCount > 0
}

export function relationLabel(relation: IssueRelation, boardRepo: string): string {
  if (sameRepo(relation.repo, boardRepo)) return `#${relation.number}`
  return `${relation.repo}#${relation.number}`
}

/** The first relations to show, plus how many open relations stay hidden. */
export function relationWindow(
  relations: IssueRelation[],
  openCount: number,
  limit = 2,
): { shown: IssueRelation[]; extra: number } {
  const shown = relations.slice(0, limit)
  const total = Math.max(openCount, relations.length)
  return { shown, extra: Math.max(0, total - shown.length) }
}

export function unlistedRelationCount(relations: IssueRelation[], openCount: number): number {
  return Math.max(0, openCount - relations.length)
}

function matchesMode(card: BoardCard, mode: Exclude<DependencyMode, 'all'>): boolean {
  if (mode === 'blocked') return cardIsBlocked(card)
  if (mode === 'blocking') return cardIsBlocking(card)
  return !cardIsBlocked(card)
}

/**
 * Keep a card only when it matches. A removed parent does not hide matching
 * descendants: those cards move up to the parent's place. Pure.
 */
function filterCardTree(card: BoardCard, mode: Exclude<DependencyMode, 'all'>): BoardCard[] {
  const subIssues = card.subIssues.flatMap((child) => filterCardTree(child, mode))
  if (!matchesMode(card, mode)) return subIssues

  const unchanged =
    subIssues.length === card.subIssues.length &&
    subIssues.every((child, index) => child === card.subIssues[index])
  return [unchanged ? card : { ...card, subIssues }]
}

/**
 * Filter a board by dependency. `all` returns the board unchanged.
 * Columns left with no cards are dropped. The input board is never mutated.
 */
export function filterBoardByDependency(board: BoardModel, mode: DependencyMode): BoardModel {
  if (mode === 'all') return board

  const columns: BoardColumn[] = []
  for (const column of board.columns) {
    const cards = column.cards.flatMap((card) => filterCardTree(card, mode))
    if (cards.length > 0) columns.push({ ...column, cards })
  }
  return { ...board, columns }
}
