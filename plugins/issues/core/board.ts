// Pure board-assembly logic, ported from the standalone github-roadmap app
// (src/lib/board/{columns,sort,build,optimistic}.ts). No manual ordering, no
// comments. Cards sort by value descending,
// then issue number descending. All functions are pure.

export interface SubIssuesSummary {
  total: number
  completed: number
  percentCompleted: number
}

export interface LinkedPullRequest {
  number: number
  title: string
  htmlUrl: string
  state: string
}

export interface IssueRelation {
  number: number
  title: string
  htmlUrl: string
  state: string
  repo: string
}

export interface BoardIssue {
  number: number
  title: string
  body: string | null
  labels: string[]
  parentIssueNumber?: number | null
  subIssuesSummary?: SubIssuesSummary | null
  linkedPullRequests?: LinkedPullRequest[]
  blockedBy?: IssueRelation[]
  blocking?: IssueRelation[]
  blockedByOpenCount?: number
  blockingOpenCount?: number
}
/** A bb thread started from an issue on this board. */
export interface IssueThreadLink {
  threadId: string
  title: string | null
}

export interface BoardCard {
  issueNumber: number
  title: string
  body: string | null
  labels: string[]
  value: number | null
  threadLink: IssueThreadLink | null
  parentIssueNumber: number | null
  subIssues: BoardCard[]
  subIssuesSummary: SubIssuesSummary | null
  linkedPullRequests: LinkedPullRequest[]
  blockedBy: IssueRelation[]
  blocking: IssueRelation[]
  /** Open blockers. Can be higher than `blockedBy.length` when the list is partial. */
  blockedByOpenCount: number
  /** Open issues this card blocks. Can be higher than `blocking.length`. */
  blockingOpenCount: number
}

export interface BoardColumn {
  /** '' for the No label / Other column. */
  label: string
  isOther: boolean
  title: string
  /** The label's GitHub hex (no '#'); null for Other or unknown labels. */
  color: string | null
  cards: BoardCard[]
}

export interface BoardModel {
  repo: string
  /** Curated columns in order, then the Other column last. */
  columns: BoardColumn[]
}

export interface BuildBoardInput {
  repo: string
  issues: BoardIssue[]
  columnLabels: string[]
  /** label name → GitHub hex (no '#'); absent → no tint. */
  labelColors?: Record<string, string>
  /** issue number → value (1..10). */
  values: Record<number, number>
  /** issue number → bb thread started from this issue. */
  threadLinks?: Record<number, IssueThreadLink>
}

export const OTHER_TITLE = 'No label / Other'

export function emptyHierarchy(): Pick<
  BoardCard,
  | 'parentIssueNumber'
  | 'subIssues'
  | 'subIssuesSummary'
  | 'linkedPullRequests'
  | 'blockedBy'
  | 'blocking'
  | 'blockedByOpenCount'
  | 'blockingOpenCount'
> {
  return {
    parentIssueNumber: null,
    subIssues: [],
    subIssuesSummary: null,
    linkedPullRequests: [],
    blockedBy: [],
    blocking: [],
    blockedByOpenCount: 0,
    blockingOpenCount: 0,
  }
}

/** Depth-first flattening of a card tree, parent before its sub-issues. */
export function flattenCards(cards: BoardCard[]): BoardCard[] {
  const out: BoardCard[] = []
  for (const card of cards) {
    out.push(card)
    if (card.subIssues.length > 0) out.push(...flattenCards(card.subIssues))
  }
  return out
}

export function mapCardTree(cards: BoardCard[], fn: (card: BoardCard) => BoardCard): BoardCard[] {
  return cards.map((card) => {
    const next = fn(card)
    return { ...next, subIssues: mapCardTree(next.subIssues, fn) }
  })
}

function parentChainCycles(issueNumber: number, parentOf: Map<number, number | null>): boolean {
  const seen = new Set<number>()
  let current: number | null = issueNumber
  while (current !== null) {
    if (seen.has(current)) return true
    seen.add(current)
    current = parentOf.get(current) ?? null
  }
  return false
}

function isolateCard(card: BoardCard): BoardCard {
  return { ...card, subIssues: [] }
}

/**
 * Nest each card under its parent when that parent is in the same card list
 * (one column). A child whose parent is missing from the list stays a root —
 * that is how a sub-issue with a different label still appears in its own
 * column. Cyclic parent links are treated as roots rather than nested.
 *
 * Pure: the input cards are not mutated.
 */
export function groupSubIssues(cards: BoardCard[]): BoardCard[] {
  const isolated = cards.map(isolateCard)
  const byNumber = new Map(isolated.map((card) => [card.issueNumber, card]))
  const parentOf = new Map(isolated.map((card) => [card.issueNumber, card.parentIssueNumber]))

  const roots: BoardCard[] = []
  for (const card of isolated) {
    const parentNumber = card.parentIssueNumber
    const parent = parentNumber !== null ? byNumber.get(parentNumber) : undefined
    if (
      !parent ||
      parentNumber === card.issueNumber ||
      parentChainCycles(card.issueNumber, parentOf)
    ) {
      roots.push(card)
      continue
    }
    parent.subIssues.push(card)
  }

  for (const card of isolated) {
    card.subIssues = sortColumnCards(card.subIssues)
  }
  return sortColumnCards(roots)
}

/** Sort by value descending, then by issue number descending. Returns a new array. */
export function sortColumnCards(cards: BoardCard[]): BoardCard[] {
  return [...cards].sort((a, b) => {
    const av = a.value ?? -Infinity
    const bv = b.value ?? -Infinity
    if (bv !== av) return bv - av // higher value first
    return b.issueNumber - a.issueNumber // newer first
  })
}

/**
 * Build the curated label columns (in order) plus a trailing "No label / Other"
 * column. A card appears in every curated column whose label it carries; cards
 * with no curated label fall into Other.
 */
export function placeCards(
  cards: BoardCard[],
  columnLabels: string[],
  labelColors: Record<string, string> = {},
): BoardColumn[] {
  const columns: BoardColumn[] = columnLabels.map((label) => ({
    label,
    isOther: false,
    title: label,
    color: labelColors[label] ?? null,
    cards: cards.filter((c) => c.labels.includes(label)),
  }))
  const other = cards.filter((c) => !c.labels.some((l) => columnLabels.includes(l)))
  columns.push({ label: '', isOther: true, title: OTHER_TITLE, color: null, cards: other })
  return columns
}

function curatedLabels(board: BoardModel): string[] {
  return board.columns.filter((column) => !column.isOther).map((column) => column.label)
}

function labelColorsFromBoard(board: BoardModel): Record<string, string> {
  const colors: Record<string, string> = {}
  for (const column of board.columns) {
    if (!column.isOther && column.color) colors[column.label] = column.color
  }
  return colors
}

/** Distinct cards on a board, flattened, each with an empty sub-issue list. */
export function uniqueCards(board: BoardModel): BoardCard[] {
  const byNumber = new Map<number, BoardCard>()
  for (const column of board.columns) {
    for (const card of flattenCards(column.cards)) {
      if (!byNumber.has(card.issueNumber)) byNumber.set(card.issueNumber, isolateCard(card))
    }
  }
  return [...byNumber.values()]
}

/**
 * Place every card by its own labels, then nest parent/child only inside a
 * column that contains both. A sub-issue whose parent lives in another column
 * stays a top-level card in this one.
 */
export function assembleColumns(
  cards: BoardCard[],
  columnLabels: string[],
  labelColors: Record<string, string> = {},
): BoardColumn[] {
  return placeCards(cards.map(isolateCard), columnLabels, labelColors).map((column) => ({
    ...column,
    cards: groupSubIssues(column.cards),
  }))
}

function rebuildBoard(board: BoardModel, cards: BoardCard[]): BoardModel {
  return {
    ...board,
    columns: assembleColumns(cards, curatedLabels(board), labelColorsFromBoard(board)),
  }
}

/** Fold open issues + local values into a sorted board model. */
export function buildBoard(input: BuildBoardInput): BoardModel {
  const cards: BoardCard[] = input.issues.map((i) => ({
    issueNumber: i.number,
    title: i.title,
    body: i.body,
    labels: i.labels,
    value: input.values[i.number] ?? null,
    threadLink: input.threadLinks?.[i.number] ?? null,
    parentIssueNumber: i.parentIssueNumber ?? null,
    subIssues: [],
    subIssuesSummary: i.subIssuesSummary ?? null,
    linkedPullRequests: i.linkedPullRequests ?? [],
    blockedBy: i.blockedBy ?? [],
    blocking: i.blocking ?? [],
    blockedByOpenCount: i.blockedByOpenCount ?? i.blockedBy?.length ?? 0,
    blockingOpenCount: i.blockingOpenCount ?? i.blocking?.length ?? 0,
  }))

  return {
    repo: input.repo,
    columns: assembleColumns(cards, input.columnLabels, input.labelColors),
  }
}

/**
 * Insert a freshly created card into the board so it shows immediately, without
 * waiting on GitHub's eventually-consistent issue list. Re-placed by label and
 * nested under its parent in any column they share. Idempotent. Pure.
 */
export function applyCreate(board: BoardModel, card: BoardCard): BoardModel {
  const created: BoardCard = isolateCard({
    ...card,
    parentIssueNumber: card.parentIssueNumber ?? null,
    subIssues: card.subIssues ?? [],
    subIssuesSummary: card.subIssuesSummary ?? null,
  })
  const catalog = uniqueCards(board)
  if (catalog.some((existing) => existing.issueNumber === created.issueNumber)) return board
  return rebuildBoard(board, [...catalog, created])
}

function patchCards(
  board: BoardModel,
  issueNumber: number,
  patch: (card: BoardCard) => BoardCard,
): BoardModel {
  return {
    ...board,
    columns: board.columns.map((col) => ({
      ...col,
      cards: mapCardTree(col.cards, (c) => (c.issueNumber === issueNumber ? patch(c) : c)),
    })),
  }
}

/** Update an issue's title across every column it appears in. Pure. */
export function applyRename(board: BoardModel, issueNumber: number, title: string): BoardModel {
  return patchCards(board, issueNumber, (c) => ({ ...c, title }))
}

/**
 * Optimistically move an issue between columns by removing `fromLabel` and adding
 * `toLabel` (either may be '' to mean "no curated label" / the Other column),
 * then re-placing the card into every column it now belongs to. Mirrors the
 * board's placement rules. The next refetch re-sorts. Pure.
 *
 * A nested sub-issue that leaves its parent's column becomes a top-level card
 * in the destination column. A sub-issue that joins its parent's column nests
 * under that parent.
 */
export function applyRelabel(
  board: BoardModel,
  issueNumber: number,
  fromLabel: string,
  toLabel: string,
): BoardModel {
  const catalog = uniqueCards(board)
  const card = catalog.find((candidate) => candidate.issueNumber === issueNumber)
  if (!card) return board

  let labels = fromLabel ? card.labels.filter((label) => label !== fromLabel) : [...card.labels]
  if (toLabel && !labels.includes(toLabel)) labels = [...labels, toLabel]

  return rebuildBoard(
    board,
    catalog.map((candidate) =>
      candidate.issueNumber === issueNumber ? isolateCard({ ...candidate, labels }) : candidate,
    ),
  )
}
