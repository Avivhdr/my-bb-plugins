import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  definePluginApp,
  experimental_Icon as Icon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  experimental_useSidebarThreads,
  experimental_useSidebarThreadSplit,
  useSdk,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginBrowserBbSdk,
  type PluginSidebarSection,
  type PluginSidebarThread,
  type PluginSidebarThreadRowStatus,
  type PluginThreadListProps,
  type ExperimentalProviderIconProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { useThreadListActions, useThreadListNavigation } from "./sidebar-actions";
import {
  cancelPrPanelRequest,
  requestPrPanel,
} from "../bb-plugin-github-insight/pr-panel-navigation";
import { ActionMenu, FOCUS_RING, TOOL_BUTTON, type MenuItem } from "./action-menu";
import {
  createSection,
  groupMenuItems,
  newThreadScope,
  snoozeMenuItems,
  threadMenuItems,
} from "./thread-actions";
import { projectBadge } from "./project-badge";
import { Tip } from "./tip";
import { PrBadgeView } from "./pr-badge";
import { readSummary, type PrSummary } from "./pr-insight";
import { useSummaries } from "./use-summaries";
import {
  createSnoozeClient,
  SnoozeOwner,
  useSnoozeControls,
  type SnoozeClient,
} from "./snooze-client";
import { snoozeCommands } from "./snooze-commands";
import { wakeLabel, wakeTitle, type SnoozeControls } from "./snooze-model";
import { useNow } from "./use-now";
import {
  buildForest,
  visibleItems,
  naturalTreePlacements,
  type TreePlacement,
  type Lifecycle,
  type ListItem,
  type ListOptions,
  type SortField,
} from "./list-model";
import type { Tab } from "./tabs";
import { DEFAULT_PREFERENCES, readPreferences, savePreferences } from "./preferences";
import { isSettled, needsAttention, relativeTime, rowState, workItems } from "./row-cues";
import { RunningGlyph } from "./running-glyph";

const OVERSCAN = 5;

const HEIGHTS: Record<ListItem["kind"], number> = { group: 36, thread: 48 };
const CHILD_INDENT = 24;

type Provider = ExperimentalProviderIconProps["provider"] & { displayName?: string };

function ProviderGlyph({
  thread,
  provider,
  quiet,
}: {
  thread: PluginSidebarThread;
  provider: Provider;
  quiet: boolean;
}) {
  const dot = needsAttention(thread) ? "bg-destructive" : thread.isUnread ? "bg-primary" : null;
  return (
    <Tip
      text={provider.displayName ?? provider.id}
      className="z-10 row-start-1 flex size-4 items-center justify-center"
    >
      <span data-provider-glyph="" className="relative flex size-4 items-center justify-center">
        <ProviderIcon
          providerKind="agent"
          provider={provider}
          aria-hidden
          className={`size-4 ${quiet ? "opacity-50" : ""}`}
        />
        {dot ? (
          <span
            aria-hidden
            className={`absolute -bottom-0.5 -right-0.5 size-2 rounded-full ring-2 ring-sidebar ${dot}`}
          />
        ) : null}
      </span>
    </Tip>
  );
}

const STATE_TONE = {
  danger: "bg-destructive/10 text-destructive",
  live: "text-primary",
  muted: "text-muted-foreground",
};

function StateOrTime({
  thread,
  hasDraft,
  now,
  wakeAt,
}: {
  thread: PluginSidebarThread;
  hasDraft: boolean;
  now: number;
  wakeAt: number | undefined;
}) {
  const state = rowState(thread, hasDraft);
  const fade =
    "transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0 group-has-[[aria-haspopup=menu][aria-expanded=true]]/row:opacity-0 [@media(hover:none)]:hidden";
  const timeClass = `text-[11px] tabular-nums text-muted-foreground ${fade}`;
  if (!state && wakeAt !== undefined)
    return (
      <time
        dateTime={new Date(wakeAt).toISOString()}
        title={wakeTitle(wakeAt)}
        className={timeClass}
      >
        {wakeLabel(wakeAt)}
      </time>
    );
  if (!state)
    return (
      <time dateTime={new Date(thread.updatedAt).toISOString()} className={timeClass}>
        {relativeTime(thread.updatedAt, now)}
      </time>
    );
  return (
    <span
      title={state.title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1 text-[11px] font-medium leading-4 ${STATE_TONE[state.tone]} ${fade}`}
    >
      {state.tone === "live" ? <RunningGlyph /> : null}
      {state.label === "Working" ? <span className="sr-only">{state.label}</span> : state.label}
    </span>
  );
}

function RowDetail({
  thread,
  rowStatus,
}: {
  thread: PluginSidebarThread;
  rowStatus: PluginSidebarThreadRowStatus | null;
}) {
  const items = workItems(thread);
  if (rowStatus)
    items.unshift({
      key: "status",
      icon: rowStatus.icon,
      text: rowStatus.label,
      title: rowStatus.label,
      error: rowStatus.tone === "error",
    });
  const branch = thread.environment?.branchName;
  const cell =
    "col-start-2 row-start-2 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground";
  if (items.length === 0)
    return branch ? (
      <span className={`${cell} gap-1`} title={branch}>
        <Icon name="GitBranch" className="size-3 shrink-0" aria-hidden />
        <span className="truncate font-mono text-[11px]">{branch}</span>
      </span>
    ) : (
      <span className={cell} />
    );
  return (
    <span className={cell}>
      {items.map((item) => (
        <Tip
          key={item.key}
          text={item.title}
          className={`z-10 inline-flex min-w-0 shrink-0 items-center gap-0.5 tabular-nums last:shrink ${item.error ? "text-destructive" : ""}`}
        >
          <Icon name={item.icon} className="size-3 shrink-0" aria-hidden />
          <span aria-hidden className="truncate">
            {item.text}
          </span>
          <span className="sr-only">{item.title}</span>
        </Tip>
      ))}
    </span>
  );
}

function ThreadRow({
  item,
  provider,
  activeThreadId,
  now,
  onToggle,
  onNavigate,
  sdk,
  sections,
  pinned,
  pullRequest,
  wakeAt,
  snoozes,
}: {
  provider: Provider;
  wakeAt: number | undefined;
  snoozes: SnoozeControls;
  pullRequest: PrSummary | null;
  item: Extract<ListItem, { kind: "thread" }>;
  activeThreadId: string | null;
  now: number;
  onToggle: (id: string) => void;
  onNavigate: () => void;
  sdk: PluginBrowserBbSdk;
  sections: readonly PluginSidebarSection[];
  pinned: readonly PluginSidebarThread[];
}) {
  const { thread } = item;
  const actions = useThreadListActions(thread);
  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const { splitProps, isAvailable: splitAvailable } = experimental_useSidebarThreadSplit(thread.id);
  const hasDraft =
    hasUnsubmittedDraft &&
    !rowStatus &&
    thread.indicator !== "draft" &&
    thread.indicator !== "working-draft";
  const selected = thread.id === activeThreadId;
  const quiet = isSettled(thread) && !selected;
  return (
    <div
      className={`group/row relative flex min-w-0 items-start ${item.context ? "opacity-60" : ""}`}
      style={{ height: HEIGHTS.thread, paddingLeft: `${item.depth * CHILD_INDENT}px` }}
    >
      <div
        className={`grid h-full min-w-0 flex-1 grid-cols-[1rem_minmax(0,1fr)_auto] grid-rows-[1.25rem_1.25rem] content-center items-center gap-x-2 rounded-lg px-2 ${selected ? "bg-sidebar-accent" : "group-hover/row:bg-sidebar-accent/60"}`}
      >
        {item.hasChildren ? (
          <span className="relative col-start-1 row-start-1 flex size-4">
            <span
              className={`flex transition-opacity group-focus-within/row:opacity-0 group-hover/row:opacity-0 [@media(hover:none)]:opacity-0 ${item.collapsed ? "opacity-0" : ""}`}
            >
              <ProviderGlyph thread={thread} provider={provider} quiet={quiet} />
            </span>
            <button
              type="button"
              aria-label={`${item.collapsed ? "Expand" : "Collapse"} ${thread.displayTitle}`}
              aria-expanded={!item.collapsed}
              className={`absolute inset-0 z-10 flex items-center justify-center rounded text-muted-foreground transition-opacity hover:text-foreground group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100 ${item.collapsed ? "" : "opacity-0"} ${FOCUS_RING}`}
              onClick={() => onToggle(item.id)}
            >
              <Icon
                name={item.collapsed ? "ChevronRight" : "ChevronDown"}
                className="size-3.5"
                aria-hidden
              />
            </button>
          </span>
        ) : (
          <ProviderGlyph thread={thread} provider={provider} quiet={quiet} />
        )}
        <a
          {...splitProps}
          href={thread.href}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          aria-current={selected ? "page" : undefined}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          onPointerDownCapture={() => cancelPrPanelRequest()}
          onClick={(event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            cancelPrPanelRequest();
            actions.open(thread.id);
            onNavigate();
          }}
          className={`col-start-2 row-start-1 truncate text-[13px] after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring ${quiet ? "text-muted-foreground" : "text-foreground"} ${thread.isUnread ? "font-semibold" : ""}`}
        >
          {thread.displayTitle}
        </a>
        <span className="relative z-10 col-start-3 row-start-1 flex items-center justify-end gap-1.5">
          {shortcut ? (
            <kbd className="rounded border border-border px-1 font-sans text-[10px] leading-4 text-muted-foreground">
              {shortcut.label}
            </kbd>
          ) : null}
          <span className="relative flex h-5 min-w-7 items-center justify-end">
            <StateOrTime thread={thread} hasDraft={hasDraft} now={now} wakeAt={wakeAt} />
            <span className="absolute -right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-[[aria-expanded=true]]:opacity-100 [@media(hover:none)]:opacity-100">
              <ActionMenu
                label={`Actions for ${thread.displayTitle}`}
                items={[
                  ...snoozeMenuItems(thread, wakeAt, snoozes),
                  ...threadMenuItems(
                    thread,
                    actions,
                    sdk,
                    sections,
                    pinned,
                    splitAvailable,
                    onNavigate,
                  ),
                ]}
              />
            </span>
          </span>
        </span>
        <RowDetail thread={thread} rowStatus={rowStatus} />
        <span className="relative z-10 col-start-3 row-start-2 flex justify-end">
          <PrBadgeView
            pullRequest={pullRequest}
            onActivate={() =>
              requestPrPanel(thread.id, () => {
                actions.open(thread.id);
                onNavigate();
              })
            }
          />
        </span>
      </div>
    </div>
  );
}

const TABS: { value: Tab; label: string; empty: string }[] = [
  { value: "attention", label: "Needs attention", empty: "Nothing needs you." },
  { value: "inflight", label: "In flight", empty: "Nothing in flight." },
  { value: "all", label: "All", empty: "No threads" },
];
const ACTIVE_ONLY: readonly Lifecycle[] = ["active"];
const LIFECYCLES: [readonly Lifecycle[], string][] = [
  [["active"], "Active"],
  [["archived"], "Archived"],
  [["active", "archived"], "Both"],
];

const BY_DATE: [ListOptions["direction"], string][] = [
  ["desc", "Newest first"],
  ["asc", "Oldest first"],
];
const DIRECTIONS: Record<SortField, [ListOptions["direction"], string][]> = {
  updated: BY_DATE,
  created: BY_DATE,
  title: [
    ["asc", "A to Z"],
    ["desc", "Z to A"],
  ],
};

function listOptionItems(
  prefs: ListOptions,
  update: (change: Partial<ListOptions>) => void,
  reset: () => void,
): MenuItem[] {
  const radio = <K extends "mode" | "sort" | "direction">(
    section: string,
    key: K,
    choices: [ListOptions[K], string][],
  ) =>
    choices.map(([value, label]): MenuItem => ({
      section,
      label,
      checked: prefs[key] === value,
      run: () => update({ [key]: value }),
    }));
  const lifecycles =
    prefs.tab === "all"
      ? LIFECYCLES.map(([value, label]): MenuItem => ({
          section: "Show",
          label,
          checked: prefs.lifecycles.join(",") === value.join(","),
          run: () => update({ lifecycles: value }),
        }))
      : [];
  return [
    ...lifecycles,
    ...radio("Group by", "mode", [
      ["project", "Project"],
      ["machine", "Machine"],
      ["section", "Section"],
    ]),
    ...radio("Sort by", "sort", [
      ["updated", "Last updated"],
      ["created", "Created"],
      ["title", "Title"],
    ]),
    ...radio("Order", "direction", DIRECTIONS[prefs.sort]),
    { label: "Reset list preferences", run: reset },
  ];
}

function TabBar({
  tab,
  panelId,
  onSelect,
}: {
  tab: Tab;
  panelId: string;
  onSelect: (tab: Tab) => void;
}) {
  const ids = useId();
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TABS.findIndex(({ value }) => value === tab);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 }[
      event.key
    ];
    if (next === undefined) return;
    event.preventDefault();
    const target = TABS[(next + TABS.length) % TABS.length]!;
    onSelect(target.value);
    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${target.value}"]`)?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Threads"
      onKeyDown={move}
      className="flex h-7 min-w-0 flex-1 items-center rounded-md bg-sidebar-accent/60 p-0.5"
    >
      {TABS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          role="tab"
          id={`${ids}-${value}`}
          data-tab={value}
          aria-selected={tab === value}
          aria-controls={panelId}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => onSelect(value)}
          className={`relative flex h-6 min-w-0 flex-1 items-center justify-center rounded-[5px] px-2 text-xs font-medium transition-colors ${FOCUS_RING} ${
            tab === value
              ? "bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="truncate">{label}</span>
        </button>
      ))}
    </div>
  );
}

function GroupHeader({
  item,
  onToggle,
  onNewThread,
  menu,
}: {
  item: Extract<ListItem, { kind: "group" }>;
  onToggle: () => void;
  onNewThread: (() => void) | null;
  menu: MenuItem[];
}) {
  const urgent = item.scope.kind === "attention";
  const badge =
    item.scope.kind === "project" ? projectBadge(item.scope.projectId, item.label) : null;
  return (
    <div className="flex items-end" style={{ height: HEIGHTS.group }}>
      <div className="group/header relative flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-1.5 hover:bg-sidebar-accent/60">
        <button
          type="button"
          aria-expanded={!item.collapsed}
          aria-label={`${item.collapsed ? "Expand" : "Collapse"} ${item.label}`}
          aria-description={`${item.count} threads`}
          className={`absolute inset-0 rounded-md ${FOCUS_RING}`}
          onClick={onToggle}
        />
        {badge ? (
          <span
            aria-hidden
            data-project-badge=""
            className="pointer-events-none flex size-5 shrink-0 items-center justify-center rounded-md border border-black/15 text-[11px] font-semibold shadow-sm"
            style={{ backgroundColor: badge.background, color: badge.foreground }}
          >
            {badge.letter}
          </span>
        ) : null}
        <span
          className={`pointer-events-none min-w-0 flex-1 truncate text-[13px] font-semibold ${urgent ? "text-destructive" : "text-foreground/90"}`}
        >
          {item.label}
        </span>
        {urgent ? (
          <span className="pointer-events-none shrink-0 rounded-full bg-destructive/10 px-1.5 text-[11px] font-medium leading-4 tabular-nums text-destructive">
            {item.count}
          </span>
        ) : null}
        {onNewThread ? (
          <button
            type="button"
            aria-label={`New thread in ${item.label}`}
            title={`New thread in ${item.label}`}
            className={`${TOOL_BUTTON} relative z-10 opacity-0 transition-opacity group-focus-within/header:opacity-100 group-hover/header:opacity-100`}
            onClick={onNewThread}
          >
            <Icon name="Plus" className="size-3.5" aria-hidden />
          </button>
        ) : null}
        {menu.length > 0 ? (
          <span className="relative z-10 opacity-0 transition-opacity group-focus-within/header:opacity-100 group-hover/header:opacity-100 has-[[aria-expanded=true]]:opacity-100">
            <ActionMenu label={`More for ${item.label}`} items={menu} />
          </span>
        ) : null}
        <Icon
          name="ChevronDown"
          aria-hidden
          className={`pointer-events-none size-3 shrink-0 text-muted-foreground transition-transform ${item.collapsed ? "-rotate-90" : ""}`}
        />
      </div>
    </div>
  );
}

function ThreadList(props: PluginThreadListProps & { snoozeClient: SnoozeClient }) {
  const [prefs, setPrefs] = useState(readPreferences);
  const lifecycles = prefs.tab === "all" ? prefs.lifecycles : ACTIVE_ONLY;
  const {
    status,
    threads,
    projects,
    sections,
    experimental_archived: archived,
  } = experimental_useSidebarThreads({ experimental_lifecycles: lifecycles });
  // Display lifecycle filters must not change selection eligibility or tree identity.
  const { threads: activeThreads } = experimental_useSidebarThreads({
    experimental_lifecycles: ACTIVE_ONLY,
  });
  const actions = useThreadListNavigation();
  const sdk = useSdk();
  const now = useNow();
  const { providers } = experimental_useProviders();
  const insight = useSummaries();
  const pullRequests = useMemo(
    () =>
      new Map(
        Object.entries(insight.summaries).map(
          ([id, value]) => [id, readSummary(value, now)] as const,
        ),
      ),
    [insight.summaries, now],
  );
  const providerById = useMemo(
    () => new Map<string, Provider>(providers.map((provider) => [provider.id, provider])),
    [providers],
  );
  const pinned = useMemo(() => {
    const forest = buildForest(threads);
    return threads
      .filter((row) => row.isPinned && !row.isHidden && !row.isArchived && !forest.parentOf(row))
      .sort((a, b) =>
        a.pinSortKey === b.pinSortKey
          ? (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
          : a.pinSortKey === null
            ? 1
            : b.pinSortKey === null
              ? -1
              : a.pinSortKey.localeCompare(b.pinSortKey),
      );
  }, [threads]);
  const snoozes = useSnoozeControls(props.snoozeClient);
  const placements = useMemo(
    () => naturalTreePlacements(activeThreads, pullRequests, snoozes.snoozed),
    [activeThreads, pullRequests, snoozes.snoozed],
  );
  const committed = useRef<{
    placements: ReadonlyMap<string, TreePlacement>;
    heldTree: TreePlacement | undefined;
  }>({ placements: new Map(), heldTree: undefined });
  const selected = props.activeThreadId ? placements.get(props.activeThreadId) : undefined;
  const previous = committed.current;
  const priorPlacement = props.activeThreadId
    ? previous.placements.get(props.activeThreadId)
    : undefined;
  const heldTree = selected
    ? previous.heldTree?.rootId === selected.rootId
      ? previous.heldTree
      : priorPlacement?.rootId === selected.rootId
        ? priorPlacement
        : selected
    : undefined;
  // Derive before rendering; only committed renders may supply transition history.
  useLayoutEffect(() => {
    committed.current = { placements, heldTree };
  }, [placements, heldTree]);
  const items = useMemo(
    () => visibleItems(threads, projects, sections, prefs, pullRequests, snoozes.snoozed, heldTree),
    [threads, projects, sections, prefs, pullRequests, snoozes.snoozed, heldTree],
  );
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const measure = () => setViewportHeight(node.clientHeight || 600);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const offsets = useMemo(() => {
    const tops = [0];
    for (const item of items) tops.push(tops.at(-1)! + HEIGHTS[item.kind]);
    return tops;
  }, [items]);
  const indexAt = (y: number) => {
    let low = 0;
    let high = items.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (offsets[mid + 1]! <= y) low = mid + 1;
      else high = mid;
    }
    return Math.min(low, Math.max(0, items.length - 1));
  };
  const start = Math.max(0, indexAt(scrollTop) - OVERSCAN);
  const end = Math.min(items.length, indexAt(scrollTop + viewportHeight) + 1 + OVERSCAN);
  const windowItems = items.slice(start, end);
  useEffect(() => savePreferences(prefs), [prefs]);
  const update = (change: Partial<ListOptions>) =>
    setPrefs((current) => ({ ...current, ...change }));
  const toggle = (
    field: keyof Pick<ListOptions, "collapsedGroups" | "collapsedThreads">,
    id: string,
  ) => {
    setPrefs((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((entry) => entry !== id)
        : [...current[field], id],
    }));
  };
  const newThreadAction = (group: Extract<ListItem, { kind: "group" }>) => {
    const scope = newThreadScope(group);
    return scope
      ? () => {
          actions.openNewThread({ ...scope, focusPrompt: true });
          props.onNavigate();
        }
      : null;
  };
  const panelId = useId();
  const showArchive = lifecycles.includes("archived");
  const archiveLoading = showArchive && archived?.status === "loading";
  const archiveError = showArchive && archived?.status === "error";
  return (
    <div className="flex h-full min-h-0 flex-col p-2 text-sm text-foreground">
      <div className="mb-1 flex h-8 shrink-0 items-center gap-1">
        <TabBar tab={prefs.tab} panelId={panelId} onSelect={(tab) => update({ tab })} />
        {prefs.mode === "section" ? (
          <button
            type="button"
            aria-label="Create section"
            title="Create section"
            className={TOOL_BUTTON}
            onClick={() => {
              void createSection(sdk)?.catch(() => toast.error("Could not create section."));
            }}
          >
            <Icon name="FolderPlus" className="size-3.5" aria-hidden />
          </button>
        ) : null}
        <ActionMenu
          label="List options"
          items={listOptionItems(prefs, update, () => setPrefs(DEFAULT_PREFERENCES))}
          icon={<Icon name="SlidersHorizontal" className="size-3.5" aria-hidden />}
        />
      </div>
      {insight.loaded && !insight.insightAvailable ? (
        <p role="note" className="mb-1 px-2 text-[11px] text-muted-foreground">
          PR status needs the GitHub Insight plugin.
        </p>
      ) : null}
      <div
        ref={scroller}
        id={panelId}
        role="tabpanel"
        aria-label={TABS.find(({ value }) => value === prefs.tab)!.label}
        data-testid="thread-scroll"
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {status === "loading" ? <p role="status">Loading threads…</p> : null}
        {status === "error" ? <p role="alert">Threads are unavailable.</p> : null}
        {archiveLoading ? (
          <p role="status" className="p-2 text-muted-foreground">
            Loading archived threads…
          </p>
        ) : null}
        {archiveError ? (
          <p role="alert" className="p-2 text-destructive">
            Archived threads are unavailable.
          </p>
        ) : null}
        {status === "ready" && !archiveLoading && !archiveError && items.length === 0 ? (
          <p className="p-2 text-muted-foreground">
            {TABS.find(({ value }) => value === prefs.tab)!.empty}
          </p>
        ) : null}
        {status === "ready" ? <div aria-hidden="true" style={{ height: offsets[start] }} /> : null}
        {status === "ready"
          ? windowItems.map((item) =>
              item.kind === "group" ? (
                <GroupHeader
                  key={item.id}
                  item={item}
                  onToggle={() => toggle("collapsedGroups", item.id)}
                  onNewThread={newThreadAction(item)}
                  menu={groupMenuItems(item, sdk)}
                />
              ) : (
                <ThreadRow
                  key={item.id}
                  item={item}
                  provider={
                    providerById.get(item.thread.providerId) ?? { id: item.thread.providerId }
                  }
                  activeThreadId={props.activeThreadId}
                  now={now}
                  onToggle={(id) => toggle("collapsedThreads", id)}
                  onNavigate={props.onNavigate}
                  sdk={sdk}
                  sections={sections}
                  pinned={pinned}
                  pullRequest={pullRequests.get(item.thread.id) ?? null}
                  wakeAt={snoozes.snoozed.get(item.thread.id)}
                  snoozes={snoozes}
                />
              ),
            )
          : null}
        {status === "ready" ? (
          <div aria-hidden="true" style={{ height: offsets[items.length]! - offsets[end]! }} />
        ) : null}
        {showArchive &&
        archived &&
        (archiveError || (status === "ready" && archived.hasNextPage)) ? (
          <button
            type="button"
            disabled={archived.isFetchingNextPage}
            className="mt-2 w-full rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"
            onClick={() => {
              void archived.fetchNextPage().catch(() => {});
            }}
          >
            {archived.isFetchNextPageError || archiveError
              ? "Retry archive"
              : archived.isFetchingNextPage
                ? "Loading more…"
                : "Show more"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  const snoozeClient = createSnoozeClient();
  for (const command of snoozeCommands(snoozeClient)) app.commands.register(command);
  app.slots.experimental_appOverlay({
    id: "snooze-state",
    component: () => <SnoozeOwner client={snoozeClient} />,
  });
  app.slots.experimental_threadList({
    id: "pr-status",
    title: "Threads with PRs",
    description: "Threads and the status of their branch pull requests.",
    component: (props) => <ThreadList {...props} snoozeClient={snoozeClient} />,
  });
});
