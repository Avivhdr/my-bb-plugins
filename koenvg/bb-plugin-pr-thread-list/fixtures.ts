import type { PluginSidebarThread, PluginSidebarProject } from "@get-bb/plugin-sdk/app";

export const project: PluginSidebarProject = {
  id: "p1",
  name: "Sample project",
  isPersonal: false,
  href: "/projects/p1",
  settingsHref: "/projects/p1/settings",
};

export function thread(overrides: Partial<PluginSidebarThread> = {}): PluginSidebarThread {
  return {
    id: "t1",
    projectId: "p1",
    title: "Prepare release",
    titleFallback: null,
    displayTitle: "Prepare release",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "pi",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: overrides.isPinned ? 100 : null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: overrides.isArchived ? 200 : null,
    href: "/projects/p1/threads/t1",
    isHidden: false,
    environment: null,
    host: null,
    createdAt: 100,
    updatedAt: 200,
    lastReadAt: null,
    latestAttentionAt: 200,
    ...overrides,
  };
}

export function snoozeSnapshot(
  snoozes: Record<string, number> = {},
  groups?: Record<string, string>,
) {
  return {
    snoozes,
    groups: groups ?? Object.fromEntries(Object.keys(snoozes).map((id) => [id, `group:${id}`])),
  };
}

export const archivedReady = {
  status: "ready" as const,
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  fetchNextPage: async () => {},
};
