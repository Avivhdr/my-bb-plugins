// Filter an already-loaded board by whether each issue has a linked bb thread.
// The signal is the same thread link the card already shows. An archived or
// deleted thread is not a link, because the server drops those before the board
// loads.

import type { BoardCard, BoardColumn, BoardModel } from './board'

/** All issues, issues with no linked thread, or issues that have one. */
export type ThreadAssociationMode = 'all' | 'without' | 'with'

function matchesMode(card: BoardCard, mode: Exclude<ThreadAssociationMode, 'all'>): boolean {
  const hasThread = card.threadLink !== null
  return mode === 'with' ? hasThread : !hasThread
}

/**
 * Keep a card only when it matches. A removed parent does not hide matching
 * descendants: those cards move up to the parent's place. Pure.
 */
function filterCardTree(card: BoardCard, mode: Exclude<ThreadAssociationMode, 'all'>): BoardCard[] {
  const subIssues = card.subIssues.flatMap((child) => filterCardTree(child, mode))
  if (!matchesMode(card, mode)) return subIssues

  const unchanged =
    subIssues.length === card.subIssues.length &&
    subIssues.every((child, index) => child === card.subIssues[index])
  return [unchanged ? card : { ...card, subIssues }]
}

/**
 * Filter a board by thread association. `all` returns the board unchanged.
 * Columns left with no cards are dropped. The input board is never mutated.
 */
export function filterBoardByThreadAssociation(board: BoardModel, mode: ThreadAssociationMode): BoardModel {
  if (mode === 'all') return board

  const columns: BoardColumn[] = []
  for (const column of board.columns) {
    const cards = column.cards.flatMap((card) => filterCardTree(card, mode))
    if (cards.length > 0) columns.push({ ...column, cards })
  }
  return { ...board, columns }
}
