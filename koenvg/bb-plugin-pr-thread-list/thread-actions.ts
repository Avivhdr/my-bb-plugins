import type {
  PluginBrowserBbSdk,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { ThreadListActions } from "./sidebar-actions";
import type { MenuItem } from "./action-menu";
import type { ListItem } from "./list-model";
import { snoozePresets, type SnoozeControls } from "./snooze-model";
import { cancelPrPanelRequest } from "../bb-plugin-github-insight/pr-panel-navigation";

const askName = (label: string, current = "") => window.prompt(label, current)?.trim() || null;

export function threadMenuItems(
  thread: PluginSidebarThread,
  actions: ThreadListActions,
  sdk: PluginBrowserBbSdk,
  sections: readonly PluginSidebarSection[],
  pinned: readonly PluginSidebarThread[],
  splitAvailable: boolean,
  onNavigate: () => void,
): MenuItem[] {
  const id = thread.id;
  const index = pinned.findIndex((row) => row.id === id);
  const items: MenuItem[] = [
    {
      label: thread.isPinned ? "Unpin" : "Pin",
      run: () => actions.togglePinned(),
    },
    {
      label: thread.isUnread ? "Mark read" : "Mark unread",
      run: () => actions.toggleRead(),
    },
    {
      label: "Rename",
      run: () => {
        const title = askName("Rename thread", thread.displayTitle);
        if (title) return actions.rename(title);
      },
    },
  ];
  if (splitAvailable)
    items.push({
      label: "Open in split",
      run: () => {
        cancelPrPanelRequest();
        actions.open(id, { split: true });
        onNavigate();
      },
    });
  if (index > 0)
    items.push({
      label: "Move up",
      run: () =>
        sdk.threads.reorderPinned({
          threadId: id,
          previousThreadId: pinned[index - 2]?.id ?? null,
          nextThreadId: pinned[index - 1]!.id,
        }),
    });
  if (index >= 0 && index < pinned.length - 1)
    items.push({
      label: "Move down",
      run: () =>
        sdk.threads.reorderPinned({
          threadId: id,
          previousThreadId: pinned[index + 1]!.id,
          nextThreadId: pinned[index + 2]?.id ?? null,
        }),
    });
  if (thread.sectionId !== null)
    items.push({
      label: "Move to Threads",
      run: () => sdk.threads.update({ threadId: id, sectionId: null }),
    });
  for (const section of sections)
    if (section.id !== thread.sectionId) {
      items.push({
        label: `Move to ${section.name}`,
        run: () => sdk.threads.update({ threadId: id, sectionId: section.id }),
      });
    }
  if (thread.environment?.id)
    items.push({
      label: "New thread in environment",
      run: () =>
        actions.openNewThread({
          projectId: thread.projectId,
          environmentId: thread.environment!.id!,
        }),
    });
  items.push(
    thread.isArchived
      ? { label: "Unarchive", run: () => sdk.threads.unarchive({ threadId: id }) }
      : { label: "Archive", run: () => actions.archive() },
  );
  items.push({ label: "Delete…", run: () => actions.requestDelete() });
  return items;
}

export function snoozeMenuItems(
  thread: PluginSidebarThread,
  wakeAt: number | undefined,
  { snooze, wake, canSnooze }: Pick<SnoozeControls, "snooze" | "wake" | "canSnooze">,
): MenuItem[] {
  const section = "Snooze";
  if (wakeAt !== undefined)
    return [
      {
        section,
        label: "Wake now",
        failure: "Could not wake the thread.",
        run: () => wake(thread.id),
      },
    ];
  if (!canSnooze(thread.id)) return [];
  // Recomputed at click time: a menu rendered yesterday must not snooze into the past.
  return snoozePresets(new Date()).map(({ label, wakeAt: shown }) => ({
    section,
    label,
    failure: "Could not snooze the thread.",
    run: () =>
      snooze(
        thread.id,
        snoozePresets(new Date()).find((preset) => preset.label === label)?.wakeAt ?? shown,
      ),
  }));
}

export function newThreadScope({
  scope,
}: Extract<ListItem, { kind: "group" }>): { projectId?: string; sectionId?: string } | null {
  if (scope.kind === "project") return { projectId: scope.projectId };
  if (scope.kind === "section") return { sectionId: scope.sectionId };
  return null;
}

export function groupMenuItems(
  group: Extract<ListItem, { kind: "group" }>,
  sdk: PluginBrowserBbSdk,
): MenuItem[] {
  const { scope } = group;
  if (scope.kind !== "section") return [];
  return [
    {
      label: "Rename section",
      run: () => {
        const name = askName("Rename section", group.label);
        if (name) return sdk.threadSections.update({ id: scope.sectionId, name });
      },
    },
  ];
}

export function createSection(sdk: PluginBrowserBbSdk): Promise<unknown> | undefined {
  const name = askName("New section name");
  if (name) return sdk.threadSections.create({ name });
}
