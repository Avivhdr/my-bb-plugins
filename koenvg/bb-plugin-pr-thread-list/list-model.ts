import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { isActive, isBusy, needsAttention } from "./row-cues";
import { pullsTreeToAttention, type AttentionTab, type Tab } from "./tabs";
import type { PrSummary } from "./pr-insight";

export type Organization = "project" | "machine" | "section";
export type Lifecycle = "active" | "archived";
export type SortField = "updated" | "created" | "title";
export interface ListOptions {
  tab: Tab;
  mode: Organization;
  lifecycles: readonly Lifecycle[];
  sort: SortField;
  direction: "asc" | "desc";
  collapsedGroups: readonly string[];
  collapsedThreads: readonly string[];
}
export type GroupScope =
  | { kind: "attention" }
  | { kind: "pinned" }
  | { kind: "threads" }
  | { kind: "snoozed" }
  | { kind: "project"; projectId: string }
  | { kind: "section"; sectionId: string }
  | { kind: "machine"; hostId: string; name: string };

const groupKey = (scope: GroupScope): string => {
  switch (scope.kind) {
    case "project":
      return `project:${scope.projectId}`;
    case "section":
      return `section:${scope.sectionId}`;
    case "machine":
      return `machine:${scope.hostId}`;
    default:
      return scope.kind;
  }
};

const GROUP_RANKS: Record<GroupScope["kind"], number> = {
  attention: 0,
  pinned: 1,
  project: 2,
  section: 2,
  machine: 2,
  threads: 3,
  snoozed: 4,
};

export type ListItem =
  | {
      kind: "group";
      id: string;
      scope: GroupScope;
      label: string;
      count: number;
      collapsed: boolean;
    }
  | {
      kind: "thread";
      id: string;
      thread: PluginSidebarThread;
      depth: number;
      hasChildren: boolean;
      collapsed: boolean;
      context: boolean;
    };

function compare(a: PluginSidebarThread, b: PluginSidebarThread, options: ListOptions): number {
  if (a.isPinned && b.isPinned) {
    if (a.pinSortKey !== null || b.pinSortKey !== null) {
      if (a.pinSortKey === null) return 1;
      if (b.pinSortKey === null) return -1;
      if (a.pinSortKey !== b.pinSortKey) return a.pinSortKey.localeCompare(b.pinSortKey);
    }
    if (a.pinnedAt !== b.pinnedAt) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
  }
  if (options.sort === "updated" && isBusy(a) !== isBusy(b)) return isBusy(a) ? -1 : 1;
  const value =
    options.sort === "title"
      ? a.displayTitle.localeCompare(b.displayTitle)
      : a[options.sort === "created" ? "createdAt" : "updatedAt"] -
        b[options.sort === "created" ? "createdAt" : "updatedAt"];
  return (options.direction === "asc" ? value : -value) || a.id.localeCompare(b.id);
}

export interface Forest {
  parentOf(thread: PluginSidebarThread): PluginSidebarThread | undefined;
  rootOf(thread: PluginSidebarThread): PluginSidebarThread;
  childrenOf(thread: PluginSidebarThread): readonly PluginSidebarThread[];
}

/** Hidden threads are left out, and one parent link of each cycle is cut. */
export function buildForest(threads: readonly PluginSidebarThread[]): Forest {
  const shown = threads.filter((t) => !t.isHidden);
  const byId = new Map(shown.map((t) => [t.id, t]));
  const parents = new Map<string, PluginSidebarThread>();
  for (const thread of shown) {
    const parent = thread.parentThreadId ? byId.get(thread.parentThreadId) : undefined;
    if (parent && parent !== thread) parents.set(thread.id, parent);
  }
  const roots = new Map<string, PluginSidebarThread>();
  for (const thread of shown) {
    const path = new Set<PluginSidebarThread>();
    let cursor = thread;
    let root: PluginSidebarThread;
    for (;;) {
      const known = roots.get(cursor.id);
      if (known) {
        root = known;
        break;
      }
      if (path.has(cursor)) {
        parents.delete(cursor.id);
        root = cursor;
        break;
      }
      path.add(cursor);
      const parent = parents.get(cursor.id);
      if (!parent) {
        root = cursor;
        break;
      }
      cursor = parent;
    }
    for (const node of path) roots.set(node.id, root);
  }
  const children = new Map<string, PluginSidebarThread[]>();
  for (const [id, parent] of parents) {
    let siblings = children.get(parent.id);
    if (!siblings) {
      siblings = [];
      children.set(parent.id, siblings);
    }
    siblings.push(byId.get(id)!);
  }
  return {
    parentOf: (thread) => parents.get(thread.id),
    rootOf: (thread) => roots.get(thread.id) ?? thread,
    childrenOf: (thread) => children.get(thread.id) ?? [],
  };
}

interface Tree {
  root: PluginSidebarThread;
  members: PluginSidebarThread[];
  rows: Set<string>;
}

function collectTrees(forest: Forest, members: readonly PluginSidebarThread[]): Tree[] {
  const trees = new Map<string, Tree>();
  for (const member of members) {
    const root = forest.rootOf(member);
    let tree = trees.get(root.id);
    if (!tree) {
      tree = { root, members: [], rows: new Set() };
      trees.set(root.id, tree);
    }
    tree.members.push(member);
    for (
      let cursor: PluginSidebarThread | undefined = member;
      cursor && !tree.rows.has(cursor.id);
      cursor = forest.parentOf(cursor)
    ) {
      tree.rows.add(cursor.id);
    }
  }
  return [...trees.values()];
}

export interface TreePlacement {
  rootId: string;
  tab: AttentionTab;
}

function tabOfTree(
  { members }: Tree,
  forest: Forest,
  isMember: (thread: PluginSidebarThread) => boolean,
  pullRequests: ReadonlyMap<string, PrSummary | null>,
): AttentionTab {
  if (members.some((t) => needsAttention(t) || t.isUnread)) return "attention";
  if (members.some(isActive)) return "inflight";
  // No eligible work or direct attention remains; apply the existing idle/PR rules.
  const isTopMember = (t: PluginSidebarThread) => {
    for (let parent = forest.parentOf(t); parent; parent = forest.parentOf(parent))
      if (isMember(parent)) return false;
    return true;
  };
  return members.some((t) =>
    pullsTreeToAttention(t, pullRequests.get(t.id) ?? null, false, isTopMember(t)),
  )
    ? "attention"
    : "inflight";
}

/** Natural placement of eligible selections, independent of tab, collapse, or a hold. */
export function naturalTreePlacements(
  threads: readonly PluginSidebarThread[],
  pullRequests: ReadonlyMap<string, PrSummary | null>,
  snoozed: ReadonlyMap<string, number>,
): ReadonlyMap<string, TreePlacement> {
  const forest = buildForest(threads);
  const isMember = (t: PluginSidebarThread) => !t.isHidden && !t.isArchived && !snoozed.has(t.id);
  const placements = new Map<string, TreePlacement>();
  for (const tree of collectTrees(forest, threads.filter(isMember))) {
    const placement = {
      rootId: tree.root.id,
      tab: tabOfTree(tree, forest, isMember, pullRequests),
    };
    for (const member of tree.members) placements.set(member.id, placement);
  }
  return placements;
}
/** One stable, flattened tree for rendering and windowing. Never mutates host rows. */
export function visibleItems(
  threads: readonly PluginSidebarThread[],
  projects: readonly PluginSidebarProject[],
  sections: readonly PluginSidebarSection[],
  options: ListOptions,
  pullRequests: ReadonlyMap<string, PrSummary | null> = new Map(),
  snoozed: ReadonlyMap<string, number> = new Map(),
  heldTree?: TreePlacement,
): ListItem[] {
  const { tab } = options;
  const projectNames = new Map(projects.map((p) => [p.id, p.name]));
  const sectionNames = new Map(sections.map((s) => [s.id, s.name]));
  const isListed = (t: PluginSidebarThread) =>
    !t.isHidden &&
    (tab === "all"
      ? options.lifecycles.includes(t.isArchived ? "archived" : "active")
      : !t.isArchived);
  const isMember = (t: PluginSidebarThread) => isListed(t) && !snoozed.has(t.id);
  const isSnoozedMember = (t: PluginSidebarThread) =>
    tab === "all" && isListed(t) && snoozed.has(t.id);
  const forest = buildForest(threads);
  const scopeOf = (
    root: PluginSidebarThread,
    members: readonly PluginSidebarThread[],
  ): GroupScope => {
    if (tab === "all" && members.some(needsAttention)) return { kind: "attention" };
    if (root.isPinned) return { kind: "pinned" };
    if (options.mode === "section")
      return root.sectionId && sectionNames.has(root.sectionId)
        ? { kind: "section", sectionId: root.sectionId }
        : { kind: "threads" };
    if (options.mode === "machine")
      return root.host
        ? { kind: "machine", hostId: root.host.id, name: root.host.name }
        : { kind: "threads" };
    return projectNames.has(root.projectId)
      ? { kind: "project", projectId: root.projectId }
      : { kind: "threads" };
  };
  const labelOf = (scope: GroupScope): string => {
    switch (scope.kind) {
      case "attention":
        return "Needs you";
      case "pinned":
        return "Pinned";
      case "threads":
        return "Threads";
      case "snoozed":
        return "Snoozed";
      case "project":
        return projectNames.get(scope.projectId) ?? "Threads";
      case "section":
        return sectionNames.get(scope.sectionId) ?? "Threads";
      case "machine":
        return scope.name;
    }
  };
  type Group = {
    scope: GroupScope;
    roots: PluginSidebarThread[];
    rows: Set<string>;
    count: number;
  };
  const groups = new Map<string, Group>();
  const add = (scope: GroupScope, { root, members, rows }: Tree) => {
    const key = groupKey(scope);
    let group = groups.get(key);
    if (!group) {
      group = { scope, roots: [], rows: new Set(), count: 0 };
      groups.set(key, group);
    }
    group.roots.push(root);
    for (const id of rows) group.rows.add(id);
    group.count += members.length;
  };
  const sectionOrder = new Map(sections.map((section, index) => [section.id, index]));
  if (options.mode === "section")
    for (const section of sections) {
      const scope: GroupScope = { kind: "section", sectionId: section.id };
      groups.set(groupKey(scope), { scope, roots: [], rows: new Set(), count: 0 });
    }
  for (const tree of collectTrees(forest, threads.filter(isMember))) {
    const effectiveTab =
      heldTree?.rootId === tree.root.id
        ? heldTree.tab
        : tabOfTree(tree, forest, isMember, pullRequests);
    if (tab !== "all" && effectiveTab !== tab) continue;
    add(scopeOf(tree.root, tree.members), tree);
  }
  for (const tree of collectTrees(forest, threads.filter(isSnoozedMember)))
    add({ kind: "snoozed" }, tree);
  const rank = (scope: GroupScope) => GROUP_RANKS[scope.kind];
  const groupOrder = [...groups.values()].sort(({ scope: a }, { scope: b }) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (a.kind === "section" && b.kind === "section")
      return (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0);
    return labelOf(a).localeCompare(labelOf(b));
  });
  const result: ListItem[] = [];
  for (const { scope, roots, rows, count } of groupOrder) {
    const key = groupKey(scope);
    const collapsed = options.collapsedGroups.includes(key);
    result.push({ kind: "group", id: key, scope, label: labelOf(scope), count, collapsed });
    if (collapsed) continue;
    const append = (thread: PluginSidebarThread, depth: number): void => {
      const descendants = forest.childrenOf(thread).filter((child) => rows.has(child.id));
      const folded = options.collapsedThreads.includes(thread.id);
      result.push({
        kind: "thread",
        id: thread.id,
        thread,
        depth,
        hasChildren: descendants.length > 0,
        collapsed: folded,
        context: !(scope.kind === "snoozed" ? isSnoozedMember : isMember)(thread),
      });
      if (!folded)
        for (const child of descendants.sort((a, b) => compare(a, b, options)))
          append(child, depth + 1);
    };
    for (const root of roots.sort((a, b) => compare(a, b, options))) append(root, 0);
  }
  return result;
}
