// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread, PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { renderSidebarSlot } from "./sidebar-actions.test-support";
import { archivedReady, project, snoozeSnapshot, thread } from "./fixtures";
import { visibleItems } from "./list-model";
import { DEFAULT_PREFERENCES, savePreferences } from "./preferences";
import { NOW_SWITCHER_COMMAND, switcherRows, switcherState } from "./now-switcher";

const other = { ...project, id: "p2", name: "Another project", href: "/projects/p2" };
const unread = (id: string, displayTitle: string, extra: Partial<PluginSidebarThread> = {}) =>
  thread({ id, displayTitle, isUnread: true, ...extra });

/** A bot launcher with two children, a thread in another project, and a running one. */
const THREADS = [
  unread("bot", "Gron Bot", { updatedAt: 500 }),
  unread("c1", "Deck for the designer", { parentThreadId: "bot", updatedAt: 400 }),
  unread("c2", "Launcher", { parentThreadId: "bot", updatedAt: 300 }),
  unread("pr", "PR", { projectId: "p2" }),
  thread({ id: "busy", displayTitle: "Busy", status: "active", runtimeStatus: "active" }),
];

const nowItems = (collapsedThreads: string[] = []) =>
  visibleItems(THREADS, [project, other], [], {
    ...DEFAULT_PREFERENCES,
    tab: "attention",
    collapsedThreads,
  });

describe("switcherRows", () => {
  it("returns the sidebar rows unchanged without a query", () => {
    const items = nowItems(["bot"]);
    expect(switcherRows(items, " ")).toEqual(items);
  });

  it("finds threads by title or group name and lists them flat under their group", () => {
    const rows = switcherRows(nowItems(), "launch");
    expect(rows.map((row) => [row.kind, row.id, row.kind === "thread" ? row.depth : null])).toEqual(
      [
        ["group", "project:p1", null],
        ["thread", "c2", 0],
      ],
    );
    expect(switcherRows(nowItems(), "another").map(({ id }) => id)).toEqual(["project:p2", "pr"]);
  });
});

const app = await loadPluginApp(() => import("./app"));
const overlay = (id: string) => app.appOverlays.find((entry) => entry.id === id)!.component;
const LIST_PROPS: PluginThreadListProps = {
  activeThreadId: null,
  activeProjectId: null,
  isCompactViewport: false,
  onNavigate: () => {},
  searchQuery: "",
};

function mount({ withList = false } = {}) {
  const Owner = overlay("snooze-state");
  const Switcher = overlay("now-switcher");
  const List = app.threadLists[0]!.component;
  return renderSidebarSlot(
    {
      component: () => (
        <>
          <Owner />
          {withList ? <List {...LIST_PROPS} /> : null}
          <Switcher />
        </>
      ),
    },
    {},
    {
      sidebarThreads: {
        threads: THREADS,
        projects: [project, other],
        sections: [],
        experimental_archived: archivedReady,
      },
      rpc: {
        listSummaries: () => ({ insightAvailable: true, summaries: {} }),
        listSnoozes: () => snoozeSnapshot(),
        listParks: () => ({ threadIds: [] }),
      },
    },
  );
}

const dialog = () => screen.queryByRole("dialog");
const options = () =>
  screen.getAllByRole("option").map((option) => option.id.replace("now-switcher-", ""));
const selected = () =>
  screen.getByRole("option", { selected: true }).id.replace("now-switcher-", "");

async function open(threadId: string | null = null) {
  await act(async () =>
    NOW_SWITCHER_COMMAND.run({ threadId, projectId: null, openPanel: () => false }),
  );
  const input = await screen.findByPlaceholderText("Go to a thread in Now…");
  await screen.findAllByRole("option");
  return input;
}

describe("Now switcher overlay", () => {
  let slot: ReturnType<typeof mount> | undefined;
  afterEach(() => {
    act(() => switcherState.set(null));
    slot?.lifecycle.unmount();
    slot = undefined;
    localStorage.clear();
  });

  it("binds Cmd+K and shows the Now tab nested like the sidebar", async () => {
    expect(NOW_SWITCHER_COMMAND.defaultShortcut).toEqual({ key: "k", mod: true });
    slot = mount();
    expect(dialog()).toBeNull();
    await open();
    // Groups sort by name, as in the sidebar.
    expect(options()).toEqual(["pr", "bot", "c1", "c2"]);
    const level = (id: string) =>
      document.getElementById(`now-switcher-${id}`)!.getAttribute("aria-level");
    expect([level("bot"), level("c1")]).toEqual(["1", "2"]);
    expect(screen.queryByRole("option", { name: /Busy/ })).toBeNull();
  });

  it("keeps a thread collapsed when the sidebar has it collapsed", async () => {
    savePreferences({ ...DEFAULT_PREFERENCES, collapsedThreads: ["bot"] });
    slot = mount({ withList: true });
    const input = await open("bot");
    expect(options()).toEqual(["pr", "bot"]);
    expect(selected()).toBe("bot");
    fireEvent.keyDown(input, { key: "ArrowRight" });
    expect(options()).toEqual(["pr", "bot", "c1", "c2"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(selected()).toBe("bot");
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    expect(options()).toEqual(["pr", "bot"]);
  });

  it("hides the threads of a group the sidebar has collapsed", async () => {
    savePreferences({ ...DEFAULT_PREFERENCES, collapsedGroups: ["project:p1"] });
    slot = mount({ withList: true });
    await open();
    expect(options()).toEqual(["pr"]);
  });

  it("starts on the open thread, searches inside collapsed threads, and opens on Enter", async () => {
    savePreferences({ ...DEFAULT_PREFERENCES, collapsedThreads: ["bot"] });
    slot = mount({ withList: true });
    const input = await open("pr");
    expect(selected()).toBe("pr");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(selected()).toBe("bot");
    fireEvent.change(input, { target: { value: "deck" } });
    expect(options()).toEqual(["c1"]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(dialog()).toBeNull();
    expect(slot.inspection.threadActionCalls).toEqual([{ method: "open", threadId: "c1" }]);
  });

  it("closes on Escape without opening a thread", async () => {
    slot = mount();
    const input = await open();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(slot.inspection.threadActionCalls).toEqual([]);
  });
});
