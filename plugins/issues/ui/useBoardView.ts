import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flattenCards, type BoardCard, type BoardColumn, type BoardModel } from "../core/board";
import { filterBoardByDependency, type DependencyMode } from "../core/dependency";
import {
  readIssuesFilterSelection,
  updateIssuesFilterSelection,
  type IssuesFilterSelection,
  type IssuesFilterValue,
} from "../core/filterSession";
import { stepIndex } from "../core/queue";
import {
  countIssues,
  countMatchingIssues,
  filterBoard,
  filterBoardByValue,
  parseQuery,
} from "../core/search";
import { filterBoardByThreadAssociation, type ThreadAssociationMode } from "../core/threadAssociation";
import type { IssuesRpc } from "./useIssuesBoard";

export type ValueOption = IssuesFilterValue;

/**
 * One field of the project's filter selection, remembered for this page session.
 * Switching projects reads that project's choice back, so the filter a user left on
 * one board is waiting when they return to it.
 */
function useSessionSelection<K extends keyof IssuesFilterSelection>(projectId: string | null, field: K) {
  const [state, setState] = useState(() => ({
    projectId,
    value: readIssuesFilterSelection(projectId)[field],
  }));
  const value = state.projectId === projectId ? state.value : readIssuesFilterSelection(projectId)[field];
  const setValue = useCallback(
    (next: IssuesFilterSelection[K]) => {
      updateIssuesFilterSelection(projectId, { [field]: next });
      setState({ projectId, value: next });
    },
    [projectId, field],
  );
  return [value, setValue] as const;
}

/** All issues, issues without a linked thread, or issues with one. */
export function useThreadFilter(board: BoardModel | null, projectId: string | null) {
  const [mode, setMode] = useSessionSelection(projectId, "threadMode");
  const filtered = useMemo(() => (board ? filterBoardByThreadAssociation(board, mode) : null), [board, mode]);
  const clear = useCallback(() => setMode("all"), [setMode]);
  const active = mode !== "all";
  return { mode, setMode, clear, board: filtered, isEmpty: active && filtered !== null && filtered.columns.length === 0 };
}

/** All issues, blocked issues, blocking issues, or issues with no open blocker. */
export function useDependencyFilter(board: BoardModel | null, projectId: string | null) {
  const [mode, setMode] = useSessionSelection(projectId, "dependencyMode");
  const filtered = useMemo(() => (board ? filterBoardByDependency(board, mode) : null), [board, mode]);
  const clear = useCallback(() => setMode("all"), [setMode]);
  const active = mode !== "all";
  return { mode, setMode, clear, board: filtered, isEmpty: active && filtered !== null && filtered.columns.length === 0 };
}

export type { DependencyMode, ThreadAssociationMode };

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
export function useValueFilter(board: BoardModel | null, projectId: string | null) {
  const [values, setValues] = useSessionSelection(projectId, "values");
  const selected = useMemo<ReadonlySet<ValueOption>>(() => new Set(values), [values]);
  const filtered = useMemo(
    () => (board ? filterBoardByValue(board, new Set(selected)) : null),
    [board, selected],
  );
  const toggle = useCallback(
    (value: ValueOption) => {
      const next = new Set(selected);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      setValues([...next]);
    },
    [selected, setValues],
  );
  const clear = useCallback(() => setValues([]), [setValues]);
  return { selected, board: filtered, hasSelection: selected.size > 0, toggle, clear };
}

/**
 * Which trays the user collapsed, by column label ('' is the "No label / Other"
 * tray). Kept in the plugin's per-project storage, so it survives restarts.
 */
export function useCollapsedColumns(rpc: IssuesRpc, projectId: string | null) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const collapsedRef = useRef<ReadonlySet<string>>(collapsed);
  // Toggles made before the stored set arrives. They apply on top of it, so an early
  // click is neither lost nor erases the other stored trays.
  const earlyChoices = useRef<Map<string, boolean> | null>(null);

  const apply = useCallback((next: ReadonlySet<string>) => {
    collapsedRef.current = next;
    setCollapsed(next);
  }, []);

  const persist = useCallback(
    (targetProjectId: string, labels: ReadonlySet<string>) => {
      rpc.call("issues_set_collapsed_columns", { projectId: targetProjectId, labels: [...labels] }).catch((cause) => {
        console.error("[issues] Failed to save collapsed columns.", cause);
      });
    },
    [rpc],
  );

  useEffect(() => {
    apply(new Set());
    if (!projectId) {
      earlyChoices.current = null;
      return;
    }
    const choices = new Map<string, boolean>();
    earlyChoices.current = choices;
    let cancelled = false;
    rpc.call("issues_get_collapsed_columns", { projectId }).then(
      (stored) => settle(stored),
      (cause) => {
        console.error("[issues] Failed to load collapsed columns.", cause);
        settle([]);
      },
    );
    function settle(stored: string[]) {
      if (cancelled) return;
      earlyChoices.current = null;
      const next = new Set(stored);
      for (const [label, isCollapsed] of choices) {
        if (isCollapsed) next.add(label);
        else next.delete(label);
      }
      apply(next);
      if (choices.size > 0 && projectId) persist(projectId, next);
    }
    return () => {
      cancelled = true;
    };
  }, [rpc, projectId, apply, persist]);

  const toggle = useCallback(
    (label: string) => {
      if (!projectId) return;
      const next = new Set(collapsedRef.current);
      const isCollapsed = !next.has(label);
      if (isCollapsed) next.add(label);
      else next.delete(label);
      apply(next);
      if (earlyChoices.current) earlyChoices.current.set(label, isCollapsed);
      else persist(projectId, next);
    },
    [projectId, apply, persist],
  );

  return { collapsed, toggle };
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
