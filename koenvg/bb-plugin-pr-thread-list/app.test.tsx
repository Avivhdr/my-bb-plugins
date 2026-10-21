// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { loadPluginApp } from "@get-bb/plugin-sdk/testing/app";
import { renderSidebarSlot as renderSlot } from "./sidebar-actions.test-support";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThreadRowStatus,
  PluginSidebarThreadShortcut,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { project, thread, snoozeSnapshot, archivedReady } from "./fixtures";
import { snoozePresets, wakeLabel } from "./snooze-model";
import {
  cancelPrPanelRequest,
  receivePrPanel,
  requestPrPanel,
} from "../bb-plugin-github-insight/pr-panel-navigation";

// The SDK harness ignores query options. Supply host-shaped snapshots for lifecycle regressions.
const lifecycleViews = vi.hoisted(() => ({
  snapshots: undefined as Record<string, PluginSidebarThread[]> | undefined,
  splitStarts: [] as string[],
}));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return {
    ...sdk,
    experimental_useSidebarThreadSplit(threadId: string) {
      const split = sdk.experimental_useSidebarThreadSplit(threadId);
      return {
        ...split,
        splitProps: {
          ...split.splitProps,
          onPointerDown: (
            ...args: Parameters<NonNullable<typeof split.splitProps.onPointerDown>>
          ) => {
            lifecycleViews.splitStarts.push(threadId);
            split.splitProps.onPointerDown?.(...args);
          },
        },
      };
    },
    experimental_useSidebarThreads(
      options: Parameters<typeof sdk.experimental_useSidebarThreads>[0],
    ) {
      const state = sdk.experimental_useSidebarThreads(options);
      const key = (options?.experimental_lifecycles ?? ["active"]).join(",");
      const threads = lifecycleViews.snapshots?.[key];
      return threads ? { ...state, threads } : state;
    },
  };
});

const app = await loadPluginApp(() => import("./app"));
let mounted: ReturnType<typeof renderSlot> | undefined;
const receivers: (() => void)[] = [];
afterEach(() => {
  mounted?.lifecycle.unmount();
  mounted = undefined;
  lifecycleViews.snapshots = undefined;
  lifecycleViews.splitStarts.length = 0;
  localStorage.clear();
  receivers.splice(0).forEach((dispose) => dispose());
  cancelPrPanelRequest();
});

function showTab(slot: ReturnType<typeof renderSlot>, name: string) {
  fireEvent.click(slot.getByRole("tab", { name }));
}
function showLifecycle(slot: ReturnType<typeof renderSlot>, name: string) {
  showTab(slot, "All");
  chooseOption(slot, name);
}
function chooseOption(slot: ReturnType<typeof renderSlot>, name: string) {
  fireEvent.click(slot.getByRole("button", { name: "List options" }));
  fireEvent.click(screen.getByRole("menuitemradio", { name }));
}
function optionChecked(slot: ReturnType<typeof renderSlot>, name: string) {
  fireEvent.click(slot.getByRole("button", { name: "List options" }));
  const checked =
    screen.getByRole("menuitemradio", { name }).getAttribute("aria-checked") === "true";
  fireEvent.keyDown(document, { key: "Escape" });
  return checked;
}

function prSummary(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    pr: { number: 42, url: "https://example.com/pull/42", state: "open" },
    checks: { failed: 0, running: 0, cancelled: 0, passed: 0, skipped: 0, failedNames: [] },
    reviewers: { pending: 0, approved: 0, changesRequested: 0, pendingNames: [] },
    blockers: [],
    error: null,
    ...overrides,
  };
}
function withSummaries(summaries: Record<string, unknown>): Partial<RenderSlotOptions> {
  return { rpc: { listSummaries: () => ({ insightAvailable: true, summaries }) } };
}

const summaryLoads = (slot: ReturnType<typeof renderSlot>) =>
  slot.inspection.rpcCalls.filter((call) => call.method === "listSummaries");

function tip(slot: ReturnType<typeof renderSlot>, text: string) {
  return Array.from(slot.container.querySelectorAll("[data-tip]")).find(
    (node) => node.textContent === text,
  );
}

function mount(
  threads = [thread()],
  state: Partial<PluginSidebarThreadsState> = {},
  extras: Partial<RenderSlotOptions> = {},
  props: Partial<PluginThreadListProps> = {},
) {
  const List = app.threadLists[0]!.component;
  const Owner = app.appOverlays[0]!.component;
  let observed: PluginSidebarThreadsState;
  let currentProps: PluginThreadListProps = {
    activeThreadId: null,
    activeProjectId: null,
    isCompactViewport: false,
    onNavigate: () => {},
    searchQuery: "",
    ...props,
  };
  const slot = {
    component: (props: PluginThreadListProps) => {
      observed = experimental_useSidebarThreads();
      return (
        <>
          <Owner />
          <List {...props} />
        </>
      );
    },
  };
  mounted = renderSlot(slot, currentProps, {
    sidebarThreads: {
      threads,
      projects: [project],
      sections: [],
      experimental_archived: archivedReady,
      ...state,
    },
    ...extras,
  });
  const result = mounted;
  return Object.assign(result, {
    update(changes: { threads?: PluginSidebarThread[]; activeThreadId?: string | null }) {
      if (changes.threads) observed.threads = changes.threads;
      if ("activeThreadId" in changes)
        currentProps = { ...currentProps, activeThreadId: changes.activeThreadId! };
      result.lifecycle.rerender(<slot.component {...currentProps} />);
    },
  });
}

const heldTabs = [
  ["attention", "Needs attention", "In flight"],
  ["inflight", "In flight", "Needs attention"],
] as const;

function family(tab: "attention" | "inflight", changed = false): PluginSidebarThread[] {
  return [
    thread({
      id: "parent",
      displayTitle: "Parent",
      status: tab === "inflight" && changed ? "idle" : "active",
    }),
    thread({
      id: "child",
      displayTitle: "Child",
      parentThreadId: "parent",
      isUnread: tab === "attention" && !changed,
    }),
    thread({ id: "grandchild", displayTitle: "Grandchild", parentThreadId: "child" }),
    thread({ id: "sibling", displayTitle: "Sibling", parentThreadId: "parent" }),
    thread({ id: "outside", displayTitle: "Outside" }),
  ];
}

function expectFamily(slot: ReturnType<typeof mount>, shown: boolean) {
  for (const name of ["Parent", "Child", "Grandchild", "Sibling"])
    expect(Boolean(slot.queryByRole("link", { name }))).toBe(shown);
}

// Host data and selection updates use the same mounted SDK slot, including combined updates.
describe.each(heldTabs)("selected tree in %s", (tab, heldTab, naturalTab) => {
  it.each(["parent", "child"])(
    "captures %s selection with separate and combined signal updates",
    (selected) => {
      for (const combined of [false, true]) {
        const slot = mount(family(tab));
        showTab(slot, heldTab);
        if (!combined) slot.update({ activeThreadId: selected });
        slot.update({ threads: family(tab, true), activeThreadId: selected });
        expectFamily(slot, true);
        expect(
          slot
            .getByRole("link", { name: selected === "parent" ? "Parent" : "Child" })
            .getAttribute("aria-current"),
        ).toBe("page");
        const child = slot.getByRole("link", { name: "Child" }).closest(".group\\/row")!;
        expect(child.querySelector(".bg-primary")).toBeNull();
        expect(Boolean(slot.container.querySelector("[data-running-glyph]"))).toBe(
          tab === "attention",
        );
        slot.lifecycle.unmount();
        mounted = undefined;
      }
    },
  );

  it("keeps navigation, nesting, and collapse current, then releases on leaving and does not restore an old hold", () => {
    const slot = mount(family(tab));
    showTab(slot, heldTab);
    slot.update({ activeThreadId: "child", threads: family(tab, true) });
    for (const activeThreadId of ["parent", "sibling", "grandchild"]) {
      slot.update({ activeThreadId });
      expectFamily(slot, true);
    }
    expect(
      slot.getByRole("link", { name: "Grandchild" }).closest<HTMLElement>(".group\\/row")!.style
        .paddingLeft,
    ).toBe("48px");
    fireEvent.click(slot.getByRole("button", { name: "Collapse Child" }));
    expect(slot.queryByRole("link", { name: "Grandchild" })).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Expand Child" }));
    expectFamily(slot, true);
    showTab(slot, naturalTab);
    expectFamily(slot, false);
    showTab(slot, "All");
    expectFamily(slot, true);
    showTab(slot, heldTab);
    expectFamily(slot, true);
    slot.update({ activeThreadId: "outside" });
    expectFamily(slot, false);
    showTab(slot, naturalTab);
    expectFamily(slot, true);
    slot.update({ activeThreadId: "child" });
    expectFamily(slot, true);
    showTab(slot, heldTab);
    expectFamily(slot, false);
  });

  it("releases when selection clears and uses current placement on remount", () => {
    const slot = mount(family(tab));
    showTab(slot, heldTab);
    slot.update({ activeThreadId: "child", threads: family(tab, true) });
    slot.update({ activeThreadId: null });
    expectFamily(slot, false);
    slot.lifecycle.unmount();
    mounted = undefined;
    const fresh = mount(family(tab, true), {}, {}, { activeThreadId: "child" });
    showTab(fresh, heldTab);
    expectFamily(fresh, false);
    showTab(fresh, naturalTab);
    expectFamily(fresh, true);
  });

  it.each(["Archived", "Both"])(
    "keeps the hold through All's %s lifecycle snapshot",
    (lifecycle) => {
      const withAncestor = (threads: PluginSidebarThread[]) =>
        threads.map((row) =>
          row.id === "parent" ? { ...row, parentThreadId: "old-parent" } : row,
        );
      const oldParent = thread({
        id: "old-parent",
        displayTitle: "Archived ancestor",
        isArchived: true,
      });
      lifecycleViews.snapshots = { active: withAncestor(family(tab)) };
      const slot = mount();
      showTab(slot, heldTab);
      slot.update({ activeThreadId: "child" });
      lifecycleViews.snapshots = {
        active: withAncestor(family(tab, true)),
        archived: [oldParent],
        "active,archived": [oldParent, ...withAncestor(family(tab, true))],
      };
      slot.update({ activeThreadId: "child" });
      expectFamily(slot, true);
      showLifecycle(slot, lifecycle);
      expect(slot.getByRole("link", { name: "Archived ancestor" })).toBeTruthy();
      expectFamily(slot, lifecycle === "Both");
      showTab(slot, heldTab);
      expectFamily(slot, true);
      showTab(slot, naturalTab);
      expectFamily(slot, false);
      slot.update({ activeThreadId: "outside" });
      expectFamily(slot, true);
    },
  );

  it("discards an active hold on remount even when the selection stays", () => {
    const slot = mount(family(tab));
    showTab(slot, heldTab);
    slot.update({ activeThreadId: "child", threads: family(tab, true) });
    expectFamily(slot, true);
    slot.lifecycle.unmount();
    mounted = undefined;
    const fresh = mount(family(tab, true), {}, {}, { activeThreadId: "child" });
    expectFamily(fresh, false);
    showTab(fresh, naturalTab);
    expectFamily(fresh, true);
  });

  it.each(["archived", "hidden", "removed"] as const)(
    "releases when the selected member becomes %s",
    (excluded) => {
      const slot = mount(family(tab));
      showTab(slot, heldTab);
      slot.update({ activeThreadId: "child", threads: family(tab, true) });
      const threads = family(tab, true).flatMap((row) =>
        row.id !== "child"
          ? [row]
          : excluded === "removed"
            ? []
            : [{ ...row, isArchived: excluded === "archived", isHidden: excluded === "hidden" }],
      );
      slot.update({ threads });
      expect(slot.queryByRole("link", { name: "Parent" })).toBeNull();
      showTab(slot, naturalTab);
      expect(slot.getByRole("link", { name: "Parent" })).toBeTruthy();
      if (excluded === "archived") {
        const context = slot.getByRole("link", { name: "Child" }).closest(".group\\/row")!;
        expect(context.classList.contains("opacity-60")).toBe(true);
      } else expect(slot.queryByRole("link", { name: "Child" })).toBeNull();
    },
  );

  it("releases after successfully snoozing the selected child without holding its awake siblings", async () => {
    let snoozes: Record<string, number> = {};
    const slot = mount(
      family(tab),
      {},
      {
        rpc: {
          listSnoozes: () => snoozeSnapshot(snoozes),
          snooze: (input) => {
            const { wakeAt } = input as { wakeAt: number };
            snoozes = { child: wakeAt, grandchild: wakeAt };
            return {};
          },
        },
      },
    );
    showTab(slot, heldTab);
    slot.update({ activeThreadId: "child", threads: family(tab, true) });
    await slot.findByRole("button", { name: "Actions for Child" });
    fireEvent.click(slot.getByRole("button", { name: "Actions for Child" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Tomorrow" }));
    await vi.waitFor(() => expect(slot.queryByRole("link", { name: "Parent" })).toBeNull());
    showTab(slot, naturalTab);
    expect(slot.getByRole("link", { name: "Parent" })).toBeTruthy();
    expect(slot.queryByRole("link", { name: "Child" })).toBeNull();
    showTab(slot, "All");
    expect(slot.getByRole("button", { name: "Collapse Snoozed" })).toBeTruthy();
    expect(slot.getByRole("link", { name: "Child" })).toBeTruthy();
  });
});

describe("new attention in a selected In flight tree", () => {
  it.each([
    ["unread output", { isUnread: true }, "unread"],
    ["approval", { hasPendingInteraction: true }, "Needs you"],
    ["input", { indicator: "waiting-for-input" }, "Needs you"],
    ["error", { indicator: "unread-error" }, "Failed"],
    ["failed queue", { queuedWork: "failed" }, "Not sent"],
  ] satisfies [string, Partial<PluginSidebarThread>, string][])(
    "shows current %s indicators without changing tabs",
    (_, signal, label) => {
      const slot = mount(family("inflight"));
      showTab(slot, "In flight");
      slot.update({ activeThreadId: "parent" });
      const threads = family("inflight").map((row) =>
        row.id === "grandchild" ? { ...row, ...signal } : row,
      );
      slot.update({ threads });
      expectFamily(slot, true);
      const row = slot.getByRole("link", { name: "Grandchild" }).closest(".group\\/row")!;
      if (label === "unread") expect(row.querySelector(".bg-primary")).toBeTruthy();
      else expect(row.textContent).toContain(label);
      showTab(slot, "Needs attention");
      expectFamily(slot, false);
      showTab(slot, "All");
      expectFamily(slot, true);
      if (label !== "unread")
        expect(slot.getByRole("button", { name: "Collapse Needs you" })).toBeTruthy();
      slot.update({ activeThreadId: "outside" });
      showTab(slot, "Needs attention");
      expectFamily(slot, true);
    },
  );

  it("shows changed PR badges while held and releases to current PR placement", async () => {
    let summary = prSummary({
      blockers: ["checks_running"],
      checks: { failed: 0, running: 1, cancelled: 0, passed: 0, skipped: 0, failedNames: [] },
    });
    const slot = mount(
      family("inflight"),
      {},
      {
        rpc: {
          listSummaries: () => ({ insightAvailable: true, summaries: { parent: summary } }),
        },
      },
    );
    showTab(slot, "In flight");
    await slot.findByRole("button", { name: /Open PR tab, PR #42: 1 check running/ });
    slot.update({ activeThreadId: "child" });
    summary = prSummary({ blockers: ["conflicts"] });
    await slot.behavior.emitRealtime("summaries.changed", {});
    await slot.findByRole("button", { name: /Open PR tab, PR #42: merge conflicts/ });
    slot.update({ threads: family("inflight", true) });
    expectFamily(slot, true);
    slot.update({ activeThreadId: "outside" });
    expectFamily(slot, false);
    showTab(slot, "Needs attention");
    expectFamily(slot, true);
  });
});

describe("thread list slot", () => {
  it("keeps a parent aligned with its siblings and indents its child under the parent title", () => {
    const slot = mount([
      thread({ id: "parent", displayTitle: "Parent" }),
      thread({ id: "child", displayTitle: "Child", parentThreadId: "parent" }),
      thread({ id: "sibling", displayTitle: "Sibling" }),
    ]);
    const row = (title: string) =>
      slot.getByRole("link", { name: title }).closest<HTMLElement>(".group\\/row")!;
    expect(row("Parent").style.paddingLeft).toBe(row("Sibling").style.paddingLeft);
    expect(row("Child").style.paddingLeft).toBe("24px");
    expect(
      slot
        .getByRole("button", { name: "Collapse Parent" })
        .parentElement?.querySelector("[data-provider-glyph]"),
    ).toBeTruthy();
  });

  it("dims an ancestor that the archived selection leaves out and still opens it", () => {
    const slot = mount([
      thread({ id: "live", displayTitle: "Live parent" }),
      thread({
        id: "done",
        displayTitle: "Done child",
        parentThreadId: "live",
        isArchived: true,
        archivedAt: 1,
      }),
    ]);
    showLifecycle(slot, "Archived");
    const row = (title: string) =>
      slot.getByRole("link", { name: title }).closest<HTMLElement>(".group\\/row")!;
    expect(row("Live parent").className).toContain("opacity-60");
    expect(row("Done child").className).not.toContain("opacity-60");
    expect(slot.getByRole("button", { name: "Collapse Live parent" })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Actions for Live parent" })).toBeTruthy();
    fireEvent.click(slot.getByRole("link", { name: "Live parent" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({ method: "open", threadId: "live" });
  });

  it("registers one selectable list and renders a seeded thread", () => {
    expect(app.threadLists).toHaveLength(1);
    expect(app.threadLists[0]?.title).toBe("Threads with PRs");
    expect(
      mount()
        .getByRole("link", { name: /Prepare release/ })
        .getAttribute("href"),
    ).toBe("/projects/p1/threads/t1");
  });
  it("stores options and collapsed groups across remounts", () => {
    const first = mount();
    chooseOption(first, "Machine");
    showLifecycle(first, "Both");
    chooseOption(first, "Title");
    first.lifecycle.unmount();
    mounted = undefined;
    const second = mount();
    expect(optionChecked(second, "Machine")).toBe(true);
    expect(second.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    expect(optionChecked(second, "Both")).toBe(true);
    expect(optionChecked(second, "Title")).toBe(true);
    fireEvent.click(second.getByRole("button", { name: "Collapse Threads" }));
    expect(second.queryByRole("link", { name: /Prepare release/ })).toBeNull();
    second.lifecycle.unmount();
    mounted = undefined;
    const third = mount();
    expect(third.queryByRole("link", { name: /Prepare release/ })).toBeNull();
    fireEvent.click(third.getByRole("button", { name: "List options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset list preferences" }));
    expect(optionChecked(third, "Project")).toBe(true);
    expect(third.getByRole("tab", { name: "Needs attention" }).getAttribute("aria-selected")).toBe(
      "true",
    );
  });
  it("pages archived threads and handles loading, errors, emptiness and exhaustion", () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined);
    const page = {
      status: "ready" as const,
      hasNextPage: true,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage,
    };
    const first = mount([thread({ isArchived: true })], { experimental_archived: page });
    showLifecycle(first, "Archived");
    expect(first.getByRole("link", { name: /Prepare release/ })).toBeTruthy();
    expect(fetchNextPage).toHaveBeenCalledOnce(); // The snooze owner starts loading the complete relationship graph.
    fireEvent.click(first.getByRole("button", { name: "Show more" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    first.lifecycle.unmount();
    const loading = mount([], {
      experimental_archived: { ...page, status: "loading", isFetchingNextPage: true },
    });
    showLifecycle(loading, "Archived");
    expect(loading.getByRole("status").textContent).toContain("Loading archived");
    expect(loading.queryByRole("button", { name: "Show more" })).toBeNull();
    loading.lifecycle.unmount();
    const error = mount([], {
      experimental_archived: { ...page, status: "error", isFetchNextPageError: true },
    });
    showLifecycle(error, "Archived");
    expect(error.getByRole("alert").textContent).toContain("Archived threads");
    fireEvent.click(error.getByRole("button", { name: "Retry archive" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(3);
    error.lifecycle.unmount();
    const initialError = mount([], {
      status: "error",
      experimental_archived: { ...page, status: "error", hasNextPage: false },
    });
    showLifecycle(initialError, "Archived");
    fireEvent.click(initialError.getByRole("button", { name: "Retry archive" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(4);
    initialError.lifecycle.unmount();
    const empty = mount([], { experimental_archived: { ...page, hasNextPage: false } });
    showLifecycle(empty, "Archived");
    expect(empty.getByText("No threads")).toBeTruthy();
    expect(empty.queryByRole("button", { name: "Show more" })).toBeNull();
  });
  it("windows large lists and excludes offscreen and collapsed PR consumers", () => {
    const rows = Array.from({ length: 240 }, (_, index) =>
      thread({
        id: `t${index}`,
        displayTitle: `Thread ${index}`,
        updatedAt: 240 - index,
        isUnread: true,
      }),
    );
    const slot = mount(rows);
    expect(slot.queryAllByTestId("pr-hook-consumer").length).toBeLessThan(40);
    expect(slot.queryByRole("link", { name: /Thread 180$/ })).toBeNull();
    const scroller = slot.getByTestId("thread-scroll");
    scroller.scrollTop = 36 + 48 * 180;
    fireEvent.scroll(scroller);
    expect(slot.getByRole("link", { name: /Thread 180$/ })).toBeTruthy();
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    fireEvent.click(slot.getByRole("button", { name: "Collapse Sample project" }));
    expect(slot.queryAllByTestId("pr-hook-consumer")).toHaveLength(0);
  });
  it("shows activity, selected/unread, draft or plugin status, and shortcut cues", () => {
    const busy = thread({
      status: "active",
      runtimeStatus: "active",
      isUnread: true,
      indicator: "waiting-for-input",
      indicatorLabel: "Thread needs user input",
      queuedWork: "waiting",
      activity: { workflows: 2, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 },
    });
    const slot = mount(
      [busy],
      {},
      {
        sidebarDraftThreadIds: ["t1"],
        sidebarRowStatuses: { t1: { icon: "Clock", label: "Scheduled", tone: "running" } },
        sidebarShortcuts: { t1: { label: "⌘1", ariaKeyshortcuts: "Meta+1" } },
      },
      { activeThreadId: "t1" },
    );
    showTab(slot, "All");
    const link = slot.getByRole("link", { name: /Prepare release/ });
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.getAttribute("aria-keyshortcuts")).toBe("Meta+1");
    expect(link.className).toContain("font-semibold");
    expect(slot.getByTitle("Thread needs user input").textContent).toBe("Needs you");
    expect(tip(slot, "Scheduled")).toBeTruthy();
    expect(slot.queryByTitle("Unsent draft")).toBeNull();
    expect(slot.getByText("⌘1")).toBeTruthy();
    expect(tip(slot, "2 workflows")).toBeTruthy();
    expect(slot.getByText("1 background agent", { selector: ".sr-only" })).toBeTruthy();
    expect(tip(slot, "Queued message waiting")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Collapse Needs you" })).toBeTruthy();
  });
  it("marks a running thread and shows its branch when nothing else needs saying", () => {
    const environment = {
      id: "e1",
      name: "Worktree",
      branchName: "feature/sidebar",
      path: "/tmp/feature",
      isWorktree: true,
      providerId: null,
      workspaceDisplayKind: null,
    };
    const slot = mount([thread({ status: "active", runtimeStatus: "active", environment })]);
    showTab(slot, "All");
    const working = slot.getByTitle("Thread active");
    expect(working.querySelector(".sr-only")?.textContent).toBe("Working");
    expect(working.textContent).toBe("Working");
    expect(slot.container.querySelector("time")).toBeNull();
    expect(slot.getByText("feature/sidebar")).toBeTruthy();
  });
  it("groups list options into labelled radio sets and names the order for the sort field", () => {
    const slot = mount();
    fireEvent.click(slot.getByRole("button", { name: "List options" }));
    const order = screen.getByRole("group", { name: "Order" });
    expect(
      Array.from(order.querySelectorAll("[role=menuitemradio]"), (item) => item.textContent),
    ).toEqual(["Newest first", "Oldest first"]);
    expect(
      screen.getByRole("group", { name: "Group by" }).querySelectorAll("[role=menuitemradio]"),
    ).toHaveLength(3);
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Oldest first" }));
    expect(optionChecked(slot, "Oldest first")).toBe(true);
    chooseOption(slot, "Title");
    fireEvent.click(slot.getByRole("button", { name: "List options" }));
    expect(
      Array.from(
        screen.getByRole("group", { name: "Order" }).querySelectorAll("[role=menuitemradio]"),
        (item) => item.textContent,
      ),
    ).toEqual(["A to Z", "Z to A"]);
    expect(screen.getByRole("menuitemradio", { name: "A to Z" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });
  it("moves through every option with the arrow keys across sections", () => {
    const slot = mount();
    fireEvent.click(slot.getByRole("button", { name: "List options" }));
    const menu = screen.getByRole("menu", { name: "List options" });
    expect(document.activeElement?.textContent).toBe("Project");
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Last updated");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement?.textContent).toBe("Reset list preferences");
  });
  it("badges project headers and scopes new threads to projects only", () => {
    const onNavigate = vi.fn();
    const slot = mount(
      [thread(), thread({ id: "t2", displayTitle: "Asks", indicator: "waiting-for-input" })],
      {},
      {},
      { onNavigate },
    );
    expect(slot.container.querySelector("[data-project-badge]")?.textContent).toBe("S");
    fireEvent.click(slot.getByRole("button", { name: "New thread in Sample project" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "openNewThread",
      options: { projectId: "p1", focusPrompt: true },
    });
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(slot.queryByRole("button", { name: "New thread in Needs you" })).toBeNull();
    expect(slot.queryByRole("button", { name: "More for Sample project" })).toBeNull();
    expect(slot.queryByRole("button", { name: "More for Needs you" })).toBeNull();
  });
  it("lists quiet threads with the others and counts only the Needs you group", () => {
    const slot = mount([
      thread(),
      thread({ id: "t2", displayTitle: "Asks", hasPendingInteraction: true }),
    ]);
    showTab(slot, "All");
    expect(slot.getByRole("link", { name: /Prepare release/ })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /settled/ })).toBeNull();
    expect(
      slot.getByRole("button", { name: "Collapse Needs you" }).parentElement?.textContent,
    ).toContain("1");
    expect(
      slot.getByRole("button", { name: "Collapse Sample project" }).parentElement?.textContent,
    ).not.toMatch(/\d/);
  });
  it("shows a draft when no plugin row status replaces it", () => {
    const slot = mount([thread()], {}, { sidebarDraftThreadIds: ["t1"] });
    expect(slot.getByTitle("Unsent draft").textContent).toBe("Draft");
  });
  it("routes row menu actions through BB and reorders pinned threads", () => {
    const rename = vi.spyOn(window, "prompt").mockReturnValue("Renamed");
    const sdk = {
      threads: {
        reorderPinned: vi.fn(async () => ({}) as never),
        unarchive: vi.fn(async () => ({}) as never),
        update: vi.fn(async () => ({}) as never),
      },
    };
    const pinned = [
      thread({ id: "t1", isPinned: true, pinnedAt: 10, pinSortKey: "a" }),
      thread({ id: "t2", displayTitle: "Second", isPinned: true, pinnedAt: 9, pinSortKey: "b" }),
    ];
    const slot = mount(pinned, {}, { sdk });
    const open = () =>
      fireEvent.click(slot.getByRole("button", { name: "Actions for Prepare release" }));
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(sdk.threads.reorderPinned).toHaveBeenCalledWith({
      threadId: "t1",
      previousThreadId: "t2",
      nextThreadId: null,
    });
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(rename).toHaveBeenCalled();
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "rename",
      threadId: "t1",
      title: "Renamed",
    });
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Mark unread" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "setRead",
      threadId: "t1",
      read: false,
    });
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "archive",
      threadId: "t1",
    });
    open();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "requestDelete",
      threadId: "t1",
    });
    rename.mockRestore();
  });
  it("offers pin reordering only between pinned top threads", () => {
    const sdk = { threads: { reorderPinned: vi.fn(async () => ({}) as never) } };
    const slot = mount(
      [
        thread({
          id: "first",
          displayTitle: "First",
          isPinned: true,
          pinnedAt: 3,
          pinSortKey: "a",
        }),
        thread({ id: "parent", displayTitle: "Parent" }),
        thread({
          id: "child",
          displayTitle: "Pinned child",
          parentThreadId: "parent",
          isPinned: true,
          pinnedAt: 2,
          pinSortKey: "b",
        }),
        thread({ id: "last", displayTitle: "Last", isPinned: true, pinnedAt: 1, pinSortKey: "c" }),
      ],
      {},
      { sdk },
    );
    fireEvent.click(slot.getByRole("button", { name: "Actions for First" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move down" }));
    expect(sdk.threads.reorderPinned).toHaveBeenCalledWith({
      threadId: "first",
      previousThreadId: "last",
      nextThreadId: null,
    });
    fireEvent.click(slot.getByRole("button", { name: "Actions for Pinned child" }));
    expect(screen.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Move down" })).toBeNull();
  });
  it("uses public SDK operations for section changes and unarchiving", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Later renamed");
    const sdk = {
      threads: {
        update: vi.fn(async () => ({}) as never),
        unarchive: vi.fn(async () => ({}) as never),
      },
      threadSections: {
        create: vi.fn(async () => ({}) as never),
        update: vi.fn(async () => ({}) as never),
      },
    };
    const slot = mount(
      [thread({ isArchived: true })],
      {
        sections: [{ id: "s1", name: "Later", createdAt: 1, updatedAt: 1 }],
      },
      { sdk },
    );
    showLifecycle(slot, "Both");
    chooseOption(slot, "Section");
    fireEvent.click(slot.getByRole("button", { name: "Actions for Prepare release" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to Later" }));
    expect(sdk.threads.update).toHaveBeenCalledWith({ threadId: "t1", sectionId: "s1" });
    fireEvent.click(slot.getByRole("button", { name: "Actions for Prepare release" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    expect(sdk.threads.unarchive).toHaveBeenCalledWith({ threadId: "t1" });
    fireEvent.click(slot.getByRole("button", { name: "Create section" }));
    expect(sdk.threadSections.create).toHaveBeenCalledWith({ name: "Later renamed" });
    prompt.mockRestore();
  });
  it("offers section group creation, rename and a scoped new-thread action", () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("Renamed section");
    const sdk = { threadSections: { update: vi.fn(async () => ({}) as never) } };
    const slot = mount(
      [],
      { sections: [{ id: "s1", name: "Later", createdAt: 1, updatedAt: 1 }] },
      { sdk },
    );
    chooseOption(slot, "Section");
    fireEvent.click(slot.getByRole("button", { name: "More for Later" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename section" }));
    expect(sdk.threadSections.update).toHaveBeenCalledWith({ id: "s1", name: "Renamed section" });
    fireEvent.click(slot.getByRole("button", { name: "New thread in Later" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "openNewThread",
      options: { sectionId: "s1", focusPrompt: true },
    });
    prompt.mockRestore();
  });
  it("keeps native link semantics, keyboard targets, split drag and compact navigation", () => {
    const onNavigate = vi.fn();
    const slot = mount([thread()], {}, {}, { isCompactViewport: true, onNavigate });
    const link = slot.getByRole("link", { name: /Prepare release/ });
    expect(link.getAttribute("href")).toBe("/projects/p1/threads/t1");
    expect(link.hasAttribute("data-sidebar-thread-shortcut-target")).toBe(true);
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("t1");
    fireEvent.click(link);
    expect(slot.inspection.threadActionCalls).toContainEqual({ method: "open", threadId: "t1" });
    expect(onNavigate).toHaveBeenCalledOnce();
    const preventModifiedNavigation = (event: MouseEvent) => {
      if (event.metaKey) event.preventDefault();
    };
    document.addEventListener("click", preventModifiedNavigation);
    fireEvent.click(link, { metaKey: true });
    document.removeEventListener("click", preventModifiedNavigation);
    expect(onNavigate).toHaveBeenCalledOnce();
    fireEvent.pointerDown(link);
    expect(lifecycleViews.splitStarts).toEqual(["t1"]);
    fireEvent.click(slot.getByRole("button", { name: "Actions for Prepare release" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));
    expect(slot.inspection.threadActionCalls).toContainEqual({
      method: "open",
      threadId: "t1",
      options: { split: true },
    });
  });
  it("opens the badge's thread and requests its PR tab without an external link", async () => {
    const onNavigate = vi.fn();
    const open = vi.fn(() => true);
    receivers.push(receivePrPanel("t1", open));
    const slot = mount(
      [thread()],
      {},
      withSummaries({ t1: prSummary({ blockers: ["checks_failed"] }) }),
      { activeThreadId: "another-thread", isCompactViewport: true, onNavigate },
    );
    const pr = await slot.findByRole("button", { name: "Open PR tab, PR #42: checks failed" });
    expect(pr.hasAttribute("href")).toBe(false);
    expect(slot.queryByText("#42")).toBeNull();
    expect(pr.textContent).toContain("Checks failed");
    fireEvent.click(pr);
    expect(slot.inspection.threadActionCalls).toEqual([{ method: "open", threadId: "t1" }]);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledOnce();
  });
  it("makes every icon, count, label, and the badge background activate the same thread", async () => {
    const onNavigate = vi.fn();
    const open = vi.fn(() => true);
    receivers.push(receivePrPanel("t1", open));
    const slot = mount(
      [thread()],
      {},
      withSummaries({
        t1: prSummary({
          blockers: ["conflicts", "checks_running", "review_required"],
          checks: { failed: 0, running: 1, cancelled: 0, passed: 0, skipped: 0, failedNames: [] },
          reviewers: { pending: 2, approved: 0, changesRequested: 0, pendingNames: ["ana", "bob"] },
        }),
      }),
      { onNavigate },
    );
    showTab(slot, "All");
    const badge = await slot.findByRole("button", {
      name: "Open PR tab, PR #42: merge conflicts, 1 check running, 2 reviews pending",
    });
    const tips = Array.from(badge.querySelectorAll("[data-tip]"));
    expect(tips).toHaveLength(4);
    const count = tips.find((node) => node.textContent?.includes("2"))!;
    expect(count).toBeTruthy();
    const label = Array.from(badge.querySelectorAll("span")).find(
      (node) => node.textContent === "Conflicts",
    )!;
    expect(label).toBeTruthy();
    const targets = [badge, ...tips, count, label];
    for (const target of targets) fireEvent.click(target);
    expect(open).toHaveBeenCalledTimes(targets.length);
    expect(onNavigate).toHaveBeenCalledTimes(targets.length);
    expect(slot.inspection.threadActionCalls).toEqual(
      targets.map(() => ({ method: "open", threadId: "t1" })),
    );
  });
  it.each(["draft", "merged", "closed"])(
    "keeps the whole %s badge actionable with its accessible status",
    async (state) => {
      const slot = mount(
        [thread()],
        {},
        withSummaries({
          t1: prSummary({
            pr: { number: 42, state, url: "https://example.com/pull/42" },
          }),
        }),
      );
      const badge = await slot.findByRole("button", { name: `Open PR tab, PR #42: ${state}` });
      expect(badge.getAttribute("type")).toBe("button");
      fireEvent.click(badge);
      expect(slot.inspection.threadActionCalls).toEqual([{ method: "open", threadId: "t1" }]);
    },
  );
  it("targets the clicked row when several threads share a PR", async () => {
    const shared = prSummary({ blockers: ["checks_failed"] });
    const slot = mount(
      [thread({ id: "t1" }), thread({ id: "t2", displayTitle: "Second" })],
      {},
      withSummaries({ t1: shared, t2: shared }),
    );
    const first = vi.fn(() => true);
    const second = vi.fn(() => true);
    receivers.push(receivePrPanel("t1", first), receivePrPanel("t2", second));
    await vi.waitFor(() =>
      expect(slot.getAllByRole("button", { name: /^Open PR tab/ })).toHaveLength(2),
    );
    fireEvent.click(slot.getAllByRole("button", { name: /^Open PR tab/ })[1]!);
    expect(slot.inspection.threadActionCalls).toEqual([{ method: "open", threadId: "t2" }]);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
  it.each(["title", "split"])(
    "cancels a pending badge request on ordinary %s navigation",
    async (kind) => {
      const slot = mount();
      requestPrPanel("t1", () => {});
      if (kind === "title") fireEvent.click(slot.getByRole("link", { name: /Prepare release/ }));
      else {
        fireEvent.click(slot.getByRole("button", { name: "Actions for Prepare release" }));
        fireEvent.click(screen.getByRole("menuitem", { name: "Open in split" }));
      }
      const open = vi.fn(() => true);
      receivers.push(receivePrPanel("t1", open));
      expect(open).not.toHaveBeenCalled();
    },
  );
  it("shows a badge only on rows with a summary", async () => {
    const shared = prSummary({ blockers: ["review_required"] });
    const slot = mount(
      [
        thread({ id: "t1" }),
        thread({ id: "t2", displayTitle: "Second" }),
        thread({ id: "t3", displayTitle: "No PR" }),
      ],
      {},
      withSummaries({ t1: shared, t2: shared }),
    );
    showTab(slot, "All");
    await vi.waitFor(() =>
      expect(
        slot.getAllByRole("button", { name: "Open PR tab, PR #42: awaiting review" }),
      ).toHaveLength(2),
    );
    expect(slot.getByRole("link", { name: "No PR" })).toBeTruthy();
    expect(slot.getAllByRole("button", { name: /^Open PR tab, PR #/ })).toHaveLength(2);
  });
  it("names pending reviewers and the checks state from github-insight", async () => {
    const slot = mount(
      [thread()],
      {},
      withSummaries({
        t1: prSummary({
          blockers: ["review_required"],
          checks: { failed: 0, running: 0, cancelled: 0, passed: 4, skipped: 0, failedNames: [] },
          reviewers: { pending: 1, approved: 0, changesRequested: 0, pendingNames: ["ana"] },
        }),
      }),
    );
    showTab(slot, "All");
    await slot.findByRole("button", { name: "Open PR tab, PR #42: 1 review pending" });
    expect(tip(slot, "1 review pending\nWaiting on: ana")).toBeTruthy();
    expect(tip(slot, "PR #42\nAll checks passed")).toBeTruthy();
  });
  it("updates the badge after the next poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      let summary = prSummary({ blockers: ["checks_running"] });
      const slot = mount(
        [thread()],
        {},
        { rpc: { listSummaries: () => ({ insightAvailable: true, summaries: { t1: summary } }) } },
      );
      showTab(slot, "All");
      await slot.findByRole("button", { name: "Open PR tab, PR #42: checks running" });
      summary = prSummary({ blockers: [] });
      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      await slot.findByRole("button", { name: "Open PR tab, PR #42: ready to merge" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("reloads summaries when the realtime connection comes back", async () => {
    const slot = mount([thread()], {}, withSummaries({}));
    await vi.waitFor(() => expect(summaryLoads(slot)).toHaveLength(1));
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await vi.waitFor(() => expect(summaryLoads(slot)).toHaveLength(2));
  });
  it("tells the user when github-insight is not available", async () => {
    const slot = mount(
      [thread()],
      {},
      { rpc: { listSummaries: () => ({ insightAvailable: false, summaries: {} }) } },
    );
    expect((await slot.findByRole("note")).textContent).toContain("GitHub Insight");
    slot.lifecycle.unmount();
    const available = mount([thread()], {}, withSummaries({ t1: prSummary() }));
    await available.findByRole("button", { name: "Open PR tab, PR #42: ready to merge" });
    expect(available.queryByRole("note")).toBeNull();
  });
  it("shows three tabs without counts and only the threads of the selected tab", async () => {
    const slot = mount(
      [
        thread({ id: "t1", displayTitle: "Idle" }),
        thread({ id: "t2", displayTitle: "Busy", status: "active" }),
        thread({ id: "t3", displayTitle: "Waits on CI" }),
      ],
      {},
      withSummaries({ t3: prSummary({ blockers: ["checks_running"] }) }),
    );
    expect(slot.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Needs attention",
      "In flight",
      "All",
    ]);
    expect(slot.getByRole("tab", { name: "Needs attention" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    await vi.waitFor(() => expect(slot.queryByRole("link", { name: "Waits on CI" })).toBeNull());
    expect(slot.getByRole("link", { name: "Idle" })).toBeTruthy();
    expect(slot.queryByRole("link", { name: "Busy" })).toBeNull();
    showTab(slot, "In flight");
    expect(slot.getByRole("tab", { name: "In flight" }).getAttribute("aria-selected")).toBe("true");
    expect(
      slot
        .getAllByRole("link", { name: /^(Idle|Busy|Waits on CI)$/ })
        .map((link) => link.textContent),
    ).toEqual(["Busy", "Waits on CI"]);
    expect(slot.getByRole("tabpanel", { name: "In flight" })).toBeTruthy();
  });
  it("moves between tabs with the arrow keys", () => {
    const slot = mount();
    const tablist = slot.getByRole("tablist", { name: "Threads" });
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(document.activeElement).toBe(slot.getByRole("tab", { name: "In flight" }));
    expect(slot.getByRole("tab", { name: "In flight" }).getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(slot.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(slot.getByRole("tab", { name: "Needs attention" }).getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(slot.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
  });
  it("names the tab state when a tab is empty", () => {
    const slot = mount([thread({ status: "active" })]);
    expect(slot.getByText("Nothing needs you.")).toBeTruthy();
    showTab(slot, "In flight");
    expect(slot.queryByText("Nothing in flight.")).toBeNull();
    slot.lifecycle.unmount();
    const idle = mount();
    showTab(idle, "In flight");
    expect(idle.getByText("Nothing in flight.")).toBeTruthy();
  });
  it("moves a thread to In flight when its summary arrives", async () => {
    const slot = mount(
      [thread({ displayTitle: "Waits on CI" })],
      {},
      withSummaries({ t1: prSummary({ blockers: ["checks_running"] }) }),
    );
    expect(slot.getByRole("link", { name: "Waits on CI" })).toBeTruthy();
    await vi.waitFor(() => expect(slot.queryByRole("link", { name: "Waits on CI" })).toBeNull());
    showTab(slot, "In flight");
    expect(slot.getByRole("link", { name: "Waits on CI" })).toBeTruthy();
  });
  it("keeps a parent in flight only while its child runs", () => {
    const rows = (status: "active" | "idle") => [
      thread({ id: "t1", displayTitle: "Parent" }),
      thread({ id: "t2", displayTitle: "Child", parentThreadId: "t1", status }),
    ];
    const running = mount(rows("active"));
    expect(running.queryByRole("link", { name: "Parent" })).toBeNull();
    showTab(running, "In flight");
    expect(running.getByRole("link", { name: "Parent" })).toBeTruthy();
    running.lifecycle.unmount();
    const done = mount(rows("idle"));
    showTab(done, "Needs attention");
    expect(done.getByRole("link", { name: "Parent" })).toBeTruthy();
  });
  it("offers the archived selection only in All, and ignores it in the other tabs", () => {
    const rows = [
      thread({ id: "t1", displayTitle: "Active work" }),
      thread({ id: "t2", displayTitle: "Old work", isArchived: true }),
    ];
    const slot = mount(rows);
    fireEvent.click(slot.getByRole("button", { name: "List options" }));
    expect(screen.queryByRole("menuitemradio", { name: "Archived" })).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    showLifecycle(slot, "Archived");
    expect(slot.getByRole("link", { name: "Old work" })).toBeTruthy();
    expect(slot.queryByRole("link", { name: "Active work" })).toBeNull();
    slot.lifecycle.unmount();
    const again = mount(rows);
    expect(optionChecked(again, "Archived")).toBe(true);
    showTab(again, "Needs attention");
    expect(again.getByRole("link", { name: "Active work" })).toBeTruthy();
    expect(again.queryByRole("link", { name: "Old work" })).toBeNull();
  });

  describe("when github-insight announces a new summary", () => {
    const pending = (count: number) =>
      prSummary({
        blockers: ["review_required"],
        reviewers: { pending: count, approved: 0, changesRequested: 0, pendingNames: [] },
      });
    const announce = () => {
      const channel = new BroadcastChannel("github-insight.summary-written");
      channel.postMessage({ threadId: "t1" });
      channel.close();
    };
    const quietly = () => new Promise((resolve) => setTimeout(resolve, 20));
    const answers = (...results: Array<unknown | Promise<unknown>>) => {
      let call = 0;
      return {
        rpc: { listSummaries: () => results[Math.min(call++, results.length - 1)] },
      } as Partial<RenderSlotOptions>;
    };
    const summariesOf = (summary: unknown) => ({
      insightAvailable: true,
      summaries: { t1: summary },
    });

    it("loads the summaries again and shows the new badge", async () => {
      const slot = mount([thread()], {}, answers(summariesOf(pending(1)), summariesOf(pending(2))));
      showTab(slot, "All");
      await slot.findByRole("button", { name: "Open PR tab, PR #42: 1 review pending" });

      announce();

      expect(
        await slot.findByRole("button", { name: "Open PR tab, PR #42: 2 reviews pending" }),
      ).toBeTruthy();
      expect(summaryLoads(slot)).toHaveLength(2);
    });

    it("keeps the newest summaries when an older load finishes after them", async () => {
      let finishOlder: (value: unknown) => void = () => {};
      const older = new Promise((resolve) => {
        finishOlder = resolve;
      });
      const slot = mount(
        [thread()],
        {},
        answers(summariesOf(pending(1)), older, summariesOf(pending(2))),
      );
      showTab(slot, "All");
      await slot.findByRole("button", { name: "Open PR tab, PR #42: 1 review pending" });
      announce();
      await vi.waitFor(() => expect(summaryLoads(slot)).toHaveLength(2));

      announce();
      await slot.findByRole("button", { name: "Open PR tab, PR #42: 2 reviews pending" });
      finishOlder(summariesOf(pending(1)));
      await quietly();

      expect(
        slot.getByRole("button", { name: "Open PR tab, PR #42: 2 reviews pending" }),
      ).toBeTruthy();
    });

    it("stops listening once the list unmounts", async () => {
      const slot = mount([thread()], {}, withSummaries({}));
      await vi.waitFor(() => expect(summaryLoads(slot)).toHaveLength(1));
      slot.lifecycle.unmount();
      mounted = undefined;

      announce();
      await quietly();

      expect(summaryLoads(slot)).toHaveLength(1);
    });
  });

  describe("when the server reports changed summaries", () => {
    const answers = (...results: Array<unknown | Promise<unknown>>) => {
      let call = 0;
      return {
        rpc: { listSummaries: () => results[Math.min(call++, results.length - 1)] },
      } as Partial<RenderSlotOptions>;
    };
    const none = { insightAvailable: true, summaries: {} };
    const running = {
      insightAvailable: true,
      summaries: { t1: prSummary({ blockers: ["checks_running"] }) },
    };

    it("loads the summaries again and moves the row to its new tab", async () => {
      const slot = mount([thread({ displayTitle: "Opened a PR" })], {}, answers(none, running));
      await vi.waitFor(() => expect(summaryLoads(slot)).toHaveLength(1));
      expect(slot.getByRole("link", { name: "Opened a PR" })).toBeTruthy();

      await slot.behavior.emitRealtime("summaries.changed", {});

      await vi.waitFor(() => expect(slot.queryByRole("link", { name: "Opened a PR" })).toBeNull());
      showTab(slot, "In flight");
      expect(slot.getByRole("link", { name: "Opened a PR" })).toBeTruthy();
      expect(slot.getByRole("button", { name: /^Open PR tab, PR #42/ })).toBeTruthy();
    });

    it("keeps the newest summaries when a load from before the signal finishes last", async () => {
      let finishOlder: (value: unknown) => void = () => {};
      const older = new Promise((resolve) => {
        finishOlder = resolve;
      });
      const slot = mount([thread({ displayTitle: "Opened a PR" })], {}, answers(older, running));
      await vi.waitFor(() => expect(summaryLoads(slot)).toHaveLength(1));

      await slot.behavior.emitRealtime("summaries.changed", {});
      await vi.waitFor(() => expect(slot.queryByRole("link", { name: "Opened a PR" })).toBeNull());
      finishOlder(none);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(slot.queryByRole("link", { name: "Opened a PR" })).toBeNull();
    });
  });

  it("keeps the provider logo and puts the lattice in the previous right-hand spinner slot", () => {
    const slot = mount([
      thread(),
      thread({
        id: "t2",
        displayTitle: "Busy",
        status: "active",
        runtimeStatus: "active",
        isUnread: true,
      }),
    ]);
    showTab(slot, "All");
    const busy = slot.getByRole("link", { name: "Busy" }).closest<HTMLElement>(".group\\/row")!;
    expect(slot.container.querySelectorAll("[data-provider-glyph]")).toHaveLength(2);
    const lattice = busy.querySelector("[data-running-glyph]")!;
    expect(lattice.getAttribute("aria-hidden")).toBe("true");
    expect(lattice.querySelectorAll("rect")).toHaveLength(9);
    expect(lattice.getAttribute("width")).toBe("12");
    expect(slot.getByTitle("Thread active").contains(lattice)).toBe(true);
    expect(busy.querySelector("[data-provider-glyph] [data-running-glyph]")).toBeNull();
    expect(busy.querySelector(".bg-primary")).toBeTruthy();
    expect(busy.querySelector("[data-icon=Spinner]")).toBeNull();
    expect(busy.textContent).toContain("Working");
  });

  it("keeps the right-hand lattice when a running parent's children collapse", () => {
    const slot = mount([
      thread({ status: "active", runtimeStatus: "active" }),
      thread({ id: "child", displayTitle: "Child", parentThreadId: "t1" }),
    ]);
    showTab(slot, "All");
    fireEvent.click(slot.getByRole("button", { name: "Collapse Prepare release" }));
    expect(slot.queryByRole("link", { name: "Child" })).toBeNull();
    const expand = slot.getByRole("button", { name: "Expand Prepare release" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(expand.classList.contains("opacity-0")).toBe(false);
    expect(expand.parentElement?.querySelector("[data-running-glyph]")).toBeNull();
    expect(slot.getByTitle("Thread active").querySelector("[data-running-glyph]")).toBeTruthy();
  });

  it.each(["starting", "active", "stopping"] as const)(
    "animates the %s lifecycle state",
    (status) => {
      const slot = mount([thread({ status, runtimeStatus: status })]);
      showTab(slot, "All");
      expect(slot.container.querySelector("[data-running-glyph]")).toBeTruthy();
    },
  );

  it("keeps attention cues ahead of the running animation", () => {
    const slot = mount([
      thread({ status: "active", runtimeStatus: "active", indicator: "waiting-for-input" }),
    ]);
    expect(slot.container.querySelector("[data-running-glyph]")).toBeNull();
    expect(slot.container.querySelector("[data-provider-glyph]")).toBeTruthy();
    expect(slot.container.querySelector(".bg-destructive")).toBeTruthy();
    expect(slot.getByTitle("Thread needs user input").textContent).toBe("Needs you");
  });

  it("uses the same right-hand lattice for background-only work", () => {
    const slot = mount([
      thread({
        activity: {
          workflows: 0,
          backgroundAgents: 1,
          backgroundCommands: 0,
          planMode: 0,
          goals: 0,
        },
      }),
    ]);
    showTab(slot, "All");
    expect(slot.container.querySelector("[data-provider-glyph]")).toBeTruthy();
    expect(
      slot.getByTitle("Background work running").querySelector("[data-running-glyph]"),
    ).toBeTruthy();
    expect(slot.container.querySelector("[data-icon=Spinner]")).toBeNull();
  });
  describe("snooze", () => {
    it("does not load snoozes when only the sidebar is mounted", () => {
      mounted = renderSlot(
        app.threadLists[0]!,
        {
          activeThreadId: null,
          activeProjectId: null,
          isCompactViewport: false,
          onNavigate: () => {},
          searchQuery: "",
        },
        { sidebarThreads: { threads: [thread()], projects: [project] } },
      );
      expect(
        mounted.inspection.rpcCalls.filter(({ method }) => method === "listSnoozes"),
      ).toHaveLength(0);
    });
    const DAY = 86_400_000;
    const withSnoozes = (snoozes: Record<string, number>, handlers: Record<string, unknown> = {}) =>
      ({
        rpc: {
          listSummaries: () => ({ insightAvailable: true, summaries: {} }),
          listSnoozes: () => snoozeSnapshot(snoozes),
          snooze: () => ({}),
          wake: () => ({}),
          ...handlers,
        },
      }) as Partial<RenderSlotOptions>;
    const calls = (slot: ReturnType<typeof renderSlot>, method: string) =>
      slot.inspection.rpcCalls.filter((call) => call.method === method).map((call) => call.input);
    const openMenu = (slot: ReturnType<typeof renderSlot>, title = "Prepare release") =>
      fireEvent.click(slot.getByRole("button", { name: `Actions for ${title}` }));

    it("snoozes a thread until a preset time from the menu", async () => {
      const slot = mount([thread()], {}, withSnoozes({}));
      await act(async () => {});
      const [tomorrow] = snoozePresets(new Date());
      openMenu(slot);
      const snoozeItems = screen.getByRole("group", { name: "Snooze" });

      expect(snoozeItems.textContent).toContain("Tomorrow");
      fireEvent.click(screen.getByRole("menuitem", { name: "Tomorrow" }));

      await vi.waitFor(() =>
        expect(calls(slot, "snooze")).toEqual([{ threadId: "t1", wakeAt: tomorrow!.wakeAt }]),
      );
    });

    it("offers no snooze for a thread that needs the user or is archived", () => {
      const slot = mount([
        thread({ hasPendingInteraction: true }),
        thread({ id: "t2", displayTitle: "Old", isArchived: true }),
      ]);
      openMenu(slot);
      expect(screen.queryByRole("group", { name: "Snooze" })).toBeNull();
      fireEvent.keyDown(document, { key: "Escape" });

      showLifecycle(slot, "Both");
      openMenu(slot, "Old");
      expect(screen.queryByRole("group", { name: "Snooze" })).toBeNull();
    });

    it("moves a snoozed thread to the Snoozed group in All and shows its wake time", async () => {
      const wakeAt = Date.now() + DAY;
      const slot = mount([thread()], {}, withSnoozes({ t1: wakeAt }));

      await vi.waitFor(() =>
        expect(slot.queryByRole("link", { name: "Prepare release" })).toBeNull(),
      );
      showTab(slot, "All");

      expect(slot.getByRole("button", { name: "Collapse Snoozed" })).toBeTruthy();
      expect(slot.getByText(wakeLabel(wakeAt)).getAttribute("title")).toMatch(/^Snoozed until /);
    });

    it("wakes a snoozed thread from the menu", async () => {
      const slot = mount([thread()], {}, withSnoozes({ t1: Date.now() + DAY }));
      showTab(slot, "All");
      await slot.findByRole("button", { name: "Collapse Snoozed" });

      openMenu(slot);
      fireEvent.click(screen.getByRole("menuitem", { name: "Wake now" }));

      await vi.waitFor(() => expect(calls(slot, "wake")).toEqual([{ threadId: "t1" }]));
    });

    it("ends the snooze of a thread that needs the user and shows it in Needs attention", async () => {
      const slot = mount(
        [thread({ hasPendingInteraction: true })],
        {},
        withSnoozes({ t1: Date.now() + DAY }),
      );

      await vi.waitFor(() => expect(calls(slot, "wake")).toEqual([{ threadId: "t1" }]));
      expect(slot.getByRole("link", { name: "Prepare release" })).toBeTruthy();
      expect(calls(slot, "listSnoozes")).toHaveLength(2);
      await slot.behavior.emitRealtime("snoozes.changed", {});
      expect(calls(slot, "wake")).toHaveLength(1);
    });

    it("loads snoozes again when the server reports a change", async () => {
      let snoozes: Record<string, number> = {};
      const slot = mount(
        [thread()],
        {},
        withSnoozes({}, { listSnoozes: () => snoozeSnapshot(snoozes) }),
      );
      await vi.waitFor(() => expect(calls(slot, "listSnoozes")).toHaveLength(1));
      expect(slot.getByRole("link", { name: "Prepare release" })).toBeTruthy();

      snoozes = { t1: Date.now() + DAY };
      await slot.behavior.emitRealtime("snoozes.changed", {});

      await vi.waitFor(() =>
        expect(slot.queryByRole("link", { name: "Prepare release" })).toBeNull(),
      );
    });
  });
});
