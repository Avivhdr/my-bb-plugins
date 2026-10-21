import { useCallback, useMemo, useState } from "react";
import { flattenCards, type BoardCard, type BoardColumn, type BoardModel } from "../core/board";
import { stepIndex } from "../core/queue";
import {
  countIssues,
  countMatchingIssues,
  filterBoard,
  filterBoardByValue,
  parseQuery,
} from "../core/search";

export type ValueOption = number | "none";

/** Board-local keyword search over the loaded board. Recomputes on every keystroke. */
export function useIssuesSearch(board: BoardModel | null) {
  const [query, setQuery] = useState("");
  const terms = useMemo(() => parseQuery(query), [query]);
  const filtered = useMemo(() => (board ? filterBoard(board, terms) : null), [board, terms]);
  const totalCount = useMemo(() => (board ? countIssues(board) : 0), [board]);
  const matchCount = useMemo(
    () => (board ? (terms.length === 0 ? totalCount : countMatchingIssues(board, terms)) : 0),
    [board, terms, totalCount],
  );
  const clear = useCallback(() => setQuery(""), []);
  return { query, setQuery, terms, board: filtered, matchCount, totalCount, active: terms.length > 0, clear };
}

/** The value chips (1..10 and "no value") that narrow the board. */
export function useValueFilter(board: BoardModel | null) {
  const [selected, setSelected] = useState<ReadonlySet<ValueOption>>(new Set());
  const filtered = useMemo(
    () => (board ? filterBoardByValue(board, new Set(selected)) : null),
    [board, selected],
  );
  const toggle = useCallback((value: ValueOption) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);
  const clear = useCallback(() => setSelected(new Set()), []);
  return { selected, board: filtered, hasSelection: selected.size > 0, toggle, clear };
}

export interface DrawerQueue {
  groupTitle: string;
  issueNumbers: number[];
  index: number;
}

function presentIssueNumbers(board: BoardModel | null): Set<number> {
  const present = new Set<number>();
  for (const column of board?.columns ?? []) {
    for (const card of flattenCards(column.cards)) present.add(card.issueNumber);
  }
  return present;
}

/**
 * The open issue drawer. Opening snapshots the clicked column's issue order, so
 * paging with ←/→ walks that column even as search or edits reshape the board.
 * `board` must be the unfiltered board, so a filter change never strands the queue.
 */
export function useIssuesDrawer(board: BoardModel | null) {
  const [open, setOpen] = useState<DrawerQueue | null>(null);

  const openIssueNumber = open ? (open.issueNumbers[open.index] ?? null) : null;

  const selectedCard = useMemo((): BoardCard | null => {
    if (openIssueNumber === null || !board) return null;
    for (const column of board.columns) {
      const card = flattenCards(column.cards).find((c) => c.issueNumber === openIssueNumber);
      if (card) return card;
    }
    return null;
  }, [board, openIssueNumber]);

  const openFrom = useCallback((card: BoardCard, column: BoardColumn) => {
    const issueNumbers = flattenCards(column.cards).map((c) => c.issueNumber);
    setOpen({ groupTitle: column.title, issueNumbers, index: issueNumbers.indexOf(card.issueNumber) });
  }, []);

  const go = useCallback(
    (direction: 1 | -1) => {
      setOpen((current) => {
        if (!current) return current;
        const index = stepIndex(current.issueNumbers, current.index, direction, presentIssueNumbers(board));
        return index === null ? null : { ...current, index };
      });
    },
    [board],
  );

  /** Step forward past an issue that was just closed, before the refetch drops it. */
  const advancePastClosed = useCallback(
    (closedIssueNumber: number) => {
      setOpen((current) => {
        if (!current) return current;
        const remaining = presentIssueNumbers(board);
        remaining.delete(closedIssueNumber);
        const index = stepIndex(current.issueNumbers, current.index, 1, remaining);
        return index === null ? null : { ...current, index };
      });
    },
    [board],
  );

  const close = useCallback(() => setOpen(null), []);

  return { open, openIssueNumber, selectedCard, openFrom, go, advancePastClosed, close };
}
