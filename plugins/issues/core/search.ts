// Pure keyword search over an already-loaded BoardModel. No network, no storage —
// filtering happens entirely against data the board already fetched, so it recomputes
// synchronously on every keystroke. See lib/board.ts for the model this operates on.

import { flattenCards, type BoardCard, type BoardColumn, type BoardModel } from './board'

/** Bare-word tokens: lowercased, deduped, whitespace-split. Empty for a blank query. */
export type SearchTerms = string[]

/** A run of text and whether it falls inside a matched term, for rendering highlights. */
export interface HighlightSegment {
  text: string
  match: boolean
}

/** Split a raw query into lowercased, deduplicated, whitespace-separated terms. */
export function parseQuery(raw: string): SearchTerms {
  const seen = new Set<string>()
  for (const word of raw.toLowerCase().trim().split(/\s+/)) {
    if (word) seen.add(word)
  }
  return [...seen]
}

/** Does a single term hit this card's title, body, or `#<issueNumber>`? */
function termMatchesCard(card: BoardCard, term: string): boolean {
  if (card.title.toLowerCase().includes(term)) return true
  if (card.body && card.body.toLowerCase().includes(term)) return true
  return String(card.issueNumber) === term
}

/** A card matches when every term hits it (in any order, anywhere). */
export function matchesCard(card: BoardCard, terms: SearchTerms): boolean {
  return terms.every((term) => termMatchesCard(card, term))
}

/**
 * Keep a parent group when the parent or any descendant matches. A matching parent
 * keeps its full subtree so the group stays intact; a non-matching parent stays as
 * context around the descendants that did match.
 */
function filterCardTree(card: BoardCard, terms: SearchTerms): BoardCard | null {
  if (matchesCard(card, terms)) return card

  const children = card.subIssues
    .map((child) => filterCardTree(child, terms))
    .filter((child): child is BoardCard => child !== null)
  if (children.length === 0) return null
  return { ...card, subIssues: children }
}

/**
 * Filter a board to only cards matching every term, dropping any column left with
 * no cards. An empty `terms` list returns the board unchanged. Pure — the input
 * board and its cards are never mutated.
 */
export function filterBoard(board: BoardModel, terms: SearchTerms): BoardModel {
  if (terms.length === 0) return board

  const columns: BoardColumn[] = []
  for (const column of board.columns) {
    const cards = column.cards
      .map((card) => filterCardTree(card, terms))
      .filter((card): card is BoardCard => card !== null)
    if (cards.length > 0) columns.push({ ...column, cards })
  }
  return { ...board, columns }
}

/**
 * Distinct issue count across a board, including nested sub-issues. A multi-label
 * card appears in every curated column whose label it carries (see placeCards in
 * lib/board.ts), so summing column lengths would over-count it.
 */
export function countIssues(board: BoardModel): number {
  const seen = new Set<number>()
  for (const column of board.columns) {
    for (const card of flattenCards(column.cards)) seen.add(card.issueNumber)
  }
  return seen.size
}

/**
 * Distinct issues whose title, body, or number hits every term, walking nested
 * sub-issues. Context-only parents kept by `filterBoard` are not counted.
 */
export function countMatchingIssues(board: BoardModel, terms: SearchTerms): number {
  if (terms.length === 0) return countIssues(board)
  const seen = new Set<number>()
  for (const column of board.columns) {
    for (const card of flattenCards(column.cards)) {
      if (matchesCard(card, terms)) seen.add(card.issueNumber)
    }
  }
  return seen.size
}

/**
 * Check if a card's value matches the selected value filter.
 * If no values are selected, all cards match.
 * If values are selected, the card must have a value matching one of them.
 */
export function cardMatchesValueFilter(card: BoardCard, selectedValues: Set<number | 'none'>): boolean {
  if (selectedValues.size === 0) return true
  if (selectedValues.has('none') && card.value === null) return true
  if (card.value !== null && selectedValues.has(card.value)) return true
  return false
}

/**
 * Filter a card tree by value. Keeps a parent when the parent or any descendant matches.
 */
function filterCardTreeByValue(card: BoardCard, selectedValues: Set<number | 'none'>): BoardCard | null {
  if (cardMatchesValueFilter(card, selectedValues)) return card

  const children = card.subIssues
    .map((child) => filterCardTreeByValue(child, selectedValues))
    .filter((child): child is BoardCard => child !== null)
  if (children.length === 0) return null
  return { ...card, subIssues: children }
}

/**
 * Filter a board to only cards matching the value filter. Empty `selectedValues` returns
 * the board unchanged. Pure — the input board and its cards are never mutated.
 */
export function filterBoardByValue(board: BoardModel, selectedValues: Set<number | 'none'>): BoardModel {
  if (selectedValues.size === 0) return board

  const columns: BoardColumn[] = []
  for (const column of board.columns) {
    const cards = column.cards
      .map((card) => filterCardTreeByValue(card, selectedValues))
      .filter((card): card is BoardCard => card !== null)
    if (cards.length > 0) columns.push({ ...column, cards })
  }
  return { ...board, columns }
}

const EXCERPT_RADIUS = 60
const ELLIPSIS = '…'

function titleMatchesEveryTerm(title: string, terms: SearchTerms): boolean {
  const lower = title.toLowerCase()
  return terms.every((term) => lower.includes(term))
}

/**
 * A short excerpt of `card.body` around the first term it matches, for showing why a
 * card matched when its title alone doesn't explain it. Returns null when there is no
 * body, or when the title already contains every term (nothing extra to show).
 */
export function cardExcerpt(card: BoardCard, terms: SearchTerms): string | null {
  if (!card.body || terms.length === 0) return null
  if (titleMatchesEveryTerm(card.title, terms)) return null

  const body = card.body.replace(/\s+/g, ' ').trim()
  const lowerBody = body.toLowerCase()

  let matchIndex = -1
  let matchLength = 0
  for (const term of terms) {
    const index = lowerBody.indexOf(term)
    if (index !== -1 && (matchIndex === -1 || index < matchIndex)) {
      matchIndex = index
      matchLength = term.length
    }
  }
  if (matchIndex === -1) return null

  const start = Math.max(0, matchIndex - EXCERPT_RADIUS)
  const end = Math.min(body.length, matchIndex + matchLength + EXCERPT_RADIUS)
  const prefix = start > 0 ? ELLIPSIS : ''
  const suffix = end < body.length ? ELLIPSIS : ''
  return `${prefix}${body.slice(start, end)}${suffix}`
}

/**
 * Split `text` into segments marking which runs fall inside a matched term, for
 * highlight rendering. Overlapping/adjacent term matches coalesce into one segment.
 * Case-insensitive; returns the whole text unmatched when there are no terms.
 */
export function highlightSegments(text: string, terms: SearchTerms): HighlightSegment[] {
  if (terms.length === 0 || text.length === 0) return [{ text, match: false }]

  const mask = new Array<boolean>(text.length).fill(false)
  const lower = text.toLowerCase()
  for (const term of terms) {
    if (!term) continue
    let from = 0
    for (;;) {
      const index = lower.indexOf(term, from)
      if (index === -1) break
      mask.fill(true, index, index + term.length)
      from = index + term.length
    }
  }

  const segments: HighlightSegment[] = []
  let runStart = 0
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || mask[i] !== mask[runStart]) {
      segments.push({ text: text.slice(runStart, i), match: mask[runStart] })
      runStart = i
    }
  }
  return segments
}
