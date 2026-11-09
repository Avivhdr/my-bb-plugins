import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  experimental_Icon as Icon,
  experimental_useSidebarThreads,
  type PluginCommandRegistration,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import {
  visibleItems,
  parkedThreads,
  type ListItem,
  type ListOptions,
  type TreePlacement,
} from "./list-model";
import { readPreferences } from "./preferences";
import { readSummary } from "./pr-insight";
import type { Summaries } from "./contract";
import { projectBadge } from "./project-badge";
import { needsAttention, relativeTime, rowState } from "./row-cues";
import { useSnoozeControls, type SnoozeClient } from "./snooze-client";
import { useParks } from "./use-parks";
import { useSummaries } from "./use-summaries";
import { useNow } from "./use-now";
import { useThreadListNavigation } from "./sidebar-actions";

/** A tiny shared store: one value, many readers. */
function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: T) {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Null when closed; otherwise the thread that was in view when it opened. */
export const switcherState = createStore<{ threadId: string | null } | null>(null);

/**
 * What the sidebar list renders from: its PR summaries, its preferences
 * (sort, grouping, collapsed groups and threads) and the tree it holds in place
 * for the open thread. The switcher draws the Now tab from the same inputs, so
 * both show the same rows.
 */
export interface SharedListState {
  summaries: Summaries["summaries"];
  prefs: ListOptions;
  heldTree: TreePlacement | undefined;
}
export const sharedListState = createStore<SharedListState | null>(null);

export const NOW_SWITCHER_COMMAND: PluginCommandRegistration = {
  id: "now-switcher",
  title: "Threads: Go to a thread in Now",
  defaultShortcut: { key: "k", mod: true },
  run: (context) => switcherState.set(switcherState.get() ? null : { threadId: context.threadId }),
};

/**
 * With no query, the rows as the sidebar's Now tab shows them. With a query,
 * every Now thread whose title or group name contains each typed word, even
 * inside a collapsed thread or group, listed flat under its group.
 */
export function switcherRows(items: readonly ListItem[], query: string): ListItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  const rows: ListItem[] = [];
  let group: Extract<ListItem, { kind: "group" }> | null = null;
  let groupShown = false;
  for (const item of items) {
    if (item.kind === "group") {
      group = item;
      groupShown = false;
      continue;
    }
    if (item.context) continue;
    const text = `${item.thread.displayTitle} ${group?.label ?? ""}`.toLowerCase();
    if (!words.every((word) => text.includes(word))) continue;
    if (group && !groupShown) {
      rows.push({ ...group, collapsed: false });
      groupShown = true;
    }
    rows.push({ ...item, depth: 0, hasChildren: false, collapsed: false });
  }
  return rows;
}

export function NowSwitcherOverlay({ client }: { client: SnoozeClient }) {
  const state = useSyncExternalStore(switcherState.subscribe, switcherState.get);
  if (!state) return null;
  return createPortal(
    <SwitcherData
      client={client}
      openedFrom={state.threadId}
      close={() => switcherState.set(null)}
    />,
    document.body,
  );
}

interface SwitcherProps {
  client: SnoozeClient;
  openedFrom: string | null;
  close: () => void;
}

function SwitcherData(props: SwitcherProps) {
  const shared = useSyncExternalStore(sharedListState.subscribe, sharedListState.get);
  return shared ? <Switcher {...props} list={shared} /> : <SwitcherOwnList {...props} />;
}

/** Used when this sidebar list is not mounted, so nothing was shared. */
function SwitcherOwnList(props: SwitcherProps) {
  const insight = useSummaries();
  const [prefs] = useState(readPreferences);
  return insight.loaded ? (
    <Switcher {...props} list={{ summaries: insight.summaries, prefs, heldTree: undefined }} />
  ) : (
    <Frame close={props.close}>
      <p role="status" className="px-3 py-6 text-center text-[13px] text-muted-foreground">
        Loading threads…
      </p>
    </Frame>
  );
}

function Frame({ close, children }: { close: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Threads in Now"
        className="flex max-h-[70vh] w-[min(36rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        {children}
      </div>
    </div>
  );
}

const CHILD_INDENT = 24;

function Switcher({ client, openedFrom, close, list }: SwitcherProps & { list: SharedListState }) {
  const now = useNow();
  const { threads, projects, sections, status } = experimental_useSidebarThreads({
    experimental_lifecycles: ["active"],
  });
  const snoozes = useSnoozeControls(client);
  const parks = useParks();
  const navigation = useThreadListNavigation();
  const pullRequests = useMemo(
    () =>
      new Map(
        Object.entries(list.summaries).map(([id, value]) => [id, readSummary(value, now)] as const),
      ),
    [list.summaries, now],
  );
  const parked = useMemo(() => parkedThreads(threads, parks.explicit), [threads, parks.explicit]);
  // Starts as the sidebar's folds; folding here does not change the sidebar.
  const [collapsedThreads, setCollapsedThreads] = useState(list.prefs.collapsedThreads);
  const items = useMemo(
    () =>
      visibleItems(
        threads,
        projects,
        sections,
        { ...list.prefs, tab: "attention", collapsedThreads },
        pullRequests,
        snoozes.snoozed,
        list.heldTree,
        parked,
      ),
    [
      threads,
      projects,
      sections,
      list.prefs,
      collapsedThreads,
      pullRequests,
      snoozes.snoozed,
      list.heldTree,
      parked,
    ],
  );
  // A search looks inside collapsed groups and threads too.
  const searchItems = useMemo(
    () =>
      visibleItems(
        threads,
        projects,
        sections,
        { ...list.prefs, tab: "attention", collapsedThreads: [], collapsedGroups: [] },
        pullRequests,
        snoozes.snoozed,
        list.heldTree,
        parked,
      ),
    [threads, projects, sections, list.prefs, pullRequests, snoozes.snoozed, list.heldTree, parked],
  );
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => (query.trim() ? switcherRows(searchItems, query) : items),
    [query, searchItems, items],
  );
  const selectable = useMemo(
    () => rows.filter((row): row is Extract<ListItem, { kind: "thread" }> => row.kind === "thread"),
    [rows],
  );
  const [activeId, setActiveId] = useState<string | null>(openedFrom);
  const active = selectable.find((row) => row.id === activeId) ?? selectable[0] ?? null;
  const restore = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const previous = restore.current;
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    document.getElementById(`now-switcher-${active.id}`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  const go = (thread: PluginSidebarThread) => {
    restore.current = null;
    close();
    navigation.open(thread.id);
  };
  const move = (step: number) => {
    if (selectable.length === 0) return;
    const index = active ? selectable.indexOf(active) : -1;
    setActiveId(selectable[(index + step + selectable.length) % selectable.length]!.id);
  };
  const setFolded = (id: string, folded: boolean) =>
    setCollapsedThreads((current) =>
      folded ? [...current.filter((entry) => entry !== id), id] : current.filter((e) => e !== id),
    );
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const browsing = query === "";
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key === "n")) {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp" || (event.ctrlKey && event.key === "p")) {
      event.preventDefault();
      move(-1);
    } else if (browsing && event.key === "ArrowRight" && active?.hasChildren) {
      event.preventDefault();
      if (active.collapsed) setFolded(active.id, false);
      else move(1);
    } else if (browsing && event.key === "ArrowLeft" && active) {
      event.preventDefault();
      if (active.hasChildren && !active.collapsed) setFolded(active.id, true);
      else if (active.depth > 0) {
        const index = selectable.indexOf(active);
        const parent = selectable
          .slice(0, index)
          .reverse()
          .find((row) => row.depth === active.depth - 1);
        if (parent) setActiveId(parent.id);
      }
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active) go(active.thread);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  return (
    <Frame close={close}>
      <input
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveId(null);
        }}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded="true"
        aria-controls="now-switcher-list"
        aria-activedescendant={active ? `now-switcher-${active.id}` : undefined}
        placeholder="Go to a thread in Now…"
        className="w-full border-b border-border bg-transparent px-4 py-3 text-[14px] outline-none placeholder:text-muted-foreground"
      />
      <div
        id="now-switcher-list"
        role="listbox"
        aria-label="Threads in Now"
        className="min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {status === "loading" ? (
          <p role="status" className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            Loading threads…
          </p>
        ) : selectable.length === 0 && query ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
            No thread in Now matches.
          </p>
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Nothing in Now.</p>
        ) : (
          rows.map((row) =>
            row.kind === "group" ? (
              <GroupRow key={row.id} row={row} />
            ) : (
              <ThreadRow
                key={row.id}
                row={row}
                now={now}
                selected={row.id === active?.id}
                onHover={() => setActiveId(row.id)}
                onOpen={() => go(row.thread)}
                onFold={() => setFolded(row.id, !row.collapsed)}
              />
            ),
          )
        )}
      </div>
    </Frame>
  );
}

function GroupRow({ row }: { row: Extract<ListItem, { kind: "group" }> }) {
  const badge = row.scope.kind === "project" ? projectBadge(row.scope.projectId, row.label) : null;
  return (
    <div
      role="presentation"
      data-switcher-group={row.id}
      className="flex items-center gap-2 px-2 pb-1 pt-2.5 first:pt-1"
    >
      {badge ? (
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-md border border-black/15 text-[11px] font-semibold shadow-sm"
          style={{ backgroundColor: badge.background, color: badge.foreground }}
        >
          {badge.letter}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground/90">
        {row.label}
      </span>
      {row.collapsed ? (
        <Icon name="ChevronDown" aria-hidden className="size-3 -rotate-90 text-muted-foreground" />
      ) : null}
    </div>
  );
}

function ThreadRow({
  row,
  now,
  selected,
  onHover,
  onOpen,
  onFold,
}: {
  row: Extract<ListItem, { kind: "thread" }>;
  now: number;
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
  onFold: () => void;
}) {
  const { thread } = row;
  const state = rowState(thread, false);
  const dot = needsAttention(thread) ? "bg-destructive" : thread.isUnread ? "bg-primary" : null;
  return (
    <div
      id={`now-switcher-${row.id}`}
      role="option"
      aria-selected={selected}
      aria-expanded={row.hasChildren ? !row.collapsed : undefined}
      aria-level={row.depth + 1}
      className={`flex cursor-pointer items-center gap-2 rounded-md py-1.5 pr-2.5 text-[13px] ${selected ? "bg-accent text-accent-foreground" : ""} ${row.context ? "opacity-60" : ""}`}
      style={{ paddingLeft: `${12 + row.depth * CHILD_INDENT}px` }}
      onMouseMove={onHover}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onOpen}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        {row.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`${row.collapsed ? "Expand" : "Collapse"} ${thread.displayTitle}`}
            className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onFold();
            }}
          >
            <Icon
              name={row.collapsed ? "ChevronRight" : "ChevronDown"}
              className="size-3.5"
              aria-hidden
            />
          </button>
        ) : dot ? (
          <span aria-hidden className={`size-2 rounded-full ${dot}`} />
        ) : null}
      </span>
      <span className={`min-w-0 flex-1 truncate ${thread.isUnread ? "font-semibold" : ""}`}>
        {thread.displayTitle}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {state ? state.label : relativeTime(thread.updatedAt, now)}
      </span>
    </div>
  );
}
