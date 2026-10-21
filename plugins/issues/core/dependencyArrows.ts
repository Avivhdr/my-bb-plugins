// Rounded arrows from a blocking issue to the issue it blocks.
// Both ends must be on the current board. The path is pure so layout code
// can measure card boxes and pass them in.

import { flattenCards, type BoardCard, type BoardColumn } from './board'
import { sameRepo } from './dependency'

export interface DependencyEdge {
  blocker: number
  blocked: number
}

export interface CardBox {
  issueNumber: number
  x: number
  y: number
  w: number
  h: number
}

export interface DrawnDependencyArrow {
  blocker: number
  blocked: number
  d: string
}

interface Anchors {
  x1: number
  y1: number
  x2: number
  y2: number
}

/** How far the line stops outside a card, so the arrowhead sits in the gap. */
const END_GAP = 10

export function dependencyEdges(cards: BoardCard[], boardRepo: string, onBoard: Set<number>): DependencyEdge[] {
  const edges: DependencyEdge[] = []
  const seen = new Set<string>()

  const add = (blocker: number, blocked: number) => {
    if (blocker === blocked) return
    if (!onBoard.has(blocker) || !onBoard.has(blocked)) return
    const key = `${blocker}->${blocked}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ blocker, blocked })
  }

  for (const card of flattenCards(cards)) {
    for (const relation of card.blockedBy) {
      if (relation.state !== 'open' || !sameRepo(relation.repo, boardRepo)) continue
      add(relation.number, card.issueNumber)
    }
    for (const relation of card.blocking) {
      if (relation.state !== 'open' || !sameRepo(relation.repo, boardRepo)) continue
      add(card.issueNumber, relation.number)
    }
  }

  return edges
}

export function peerIssueNumbers(edges: DependencyEdge[], issueNumber: number): number[] {
  const peers = new Set<number>()
  for (const edge of edges) {
    if (edge.blocker === issueNumber) peers.add(edge.blocked)
    if (edge.blocked === issueNumber) peers.add(edge.blocker)
  }
  peers.delete(issueNumber)
  return [...peers]
}

function rawAnchors(from: CardBox, to: CardBox): Anchors {
  const fromCx = from.x + from.w / 2
  const fromCy = from.y + from.h / 2
  const toCx = to.x + to.w / 2
  const toCy = to.y + to.h / 2
  const dx = toCx - fromCx
  const dy = toCy - fromCy
  if (Math.abs(dx) >= Math.abs(dy)) {
    if (dx >= 0) return { x1: from.x + from.w, y1: fromCy, x2: to.x, y2: toCy }
    return { x1: from.x, y1: fromCy, x2: to.x + to.w, y2: toCy }
  }
  if (dy >= 0) return { x1: fromCx, y1: from.y + from.h, x2: toCx, y2: to.y }
  return { x1: fromCx, y1: from.y, x2: toCx, y2: to.y + to.h }
}

/** Pull each end off the card border so the curve starts and ends in the gap. */
export function arrowAnchors(from: CardBox, to: CardBox): Anchors {
  const raw = rawAnchors(from, to)
  const dx = raw.x2 - raw.x1
  const dy = raw.y2 - raw.y1
  if (Math.abs(dx) >= Math.abs(dy)) {
    const gap = Math.abs(dx)
    const pad = Math.min(END_GAP, gap / 3)
    const sign = Math.sign(dx) || 1
    return { x1: raw.x1 + sign * pad, y1: raw.y1, x2: raw.x2 - sign * pad, y2: raw.y2 }
  }
  const gap = Math.abs(dy)
  const pad = Math.min(END_GAP, gap / 3)
  const sign = Math.sign(dy) || 1
  return { x1: raw.x1, y1: raw.y1 + sign * pad, x2: raw.x2, y2: raw.y2 - sign * pad }
}

/** A cubic curve that leaves one card and arrives at the other on a rounded path. */
export function dependencyArrowPath(anchors: Anchors): string {
  const dx = anchors.x2 - anchors.x1
  const dy = anchors.y2 - anchors.y1
  const pull = Math.max(28, Math.min(Math.abs(dx), Math.abs(dy)) * 0.15 + Math.max(Math.abs(dx), Math.abs(dy)) * 0.35)
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = Math.sign(dx) || 1
    return `M ${anchors.x1} ${anchors.y1} C ${anchors.x1 + sign * pull} ${anchors.y1}, ${anchors.x2 - sign * pull} ${anchors.y2}, ${anchors.x2} ${anchors.y2}`
  }
  const sign = Math.sign(dy) || 1
  return `M ${anchors.x1} ${anchors.y1} C ${anchors.x1} ${anchors.y1 + sign * pull}, ${anchors.x2} ${anchors.y2 - sign * pull}, ${anchors.x2} ${anchors.y2}`
}

export function arrowsBetween(edges: DependencyEdge[], boxes: CardBox[]): DrawnDependencyArrow[] {
  const byNumber = new Map<number, CardBox>()
  for (const box of boxes) {
    if (box.w <= 0 || box.h <= 0) continue
    if (!byNumber.has(box.issueNumber)) byNumber.set(box.issueNumber, box)
  }

  const arrows: DrawnDependencyArrow[] = []
  for (const edge of edges) {
    const from = byNumber.get(edge.blocker)
    const to = byNumber.get(edge.blocked)
    if (!from || !to) continue
    arrows.push({ blocker: edge.blocker, blocked: edge.blocked, d: dependencyArrowPath(arrowAnchors(from, to)) })
  }
  return arrows
}

export function readCardBoxes(root: HTMLElement): CardBox[] {
  const origin = root.getBoundingClientRect()
  const boxes: CardBox[] = []
  const seen = new Set<number>()
  for (const element of Array.from(root.querySelectorAll<HTMLElement>('[data-issue-number]'))) {
    const issueNumber = Number(element.dataset.issueNumber)
    if (!Number.isInteger(issueNumber) || seen.has(issueNumber)) continue
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    seen.add(issueNumber)
    boxes.push({
      issueNumber,
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      w: rect.width,
      h: rect.height,
    })
  }
  return boxes
}

export function measureBoardArrows(root: HTMLElement, columns: BoardColumn[], repo: string): DrawnDependencyArrow[] {
  const cards = columns.flatMap((column) => column.cards)
  const onBoard = new Set(flattenCards(cards).map((card) => card.issueNumber))
  return arrowsBetween(dependencyEdges(cards, repo, onBoard), readCardBoxes(root))
}
