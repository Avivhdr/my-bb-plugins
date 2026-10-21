// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLayoutEffect, useRef, type ComponentType } from "react";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import {
  definePluginApp,
  useRealtimeConnectionState,
  type PluginCommandContext,
  type PluginCommandRegistration,
} from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";
import definition from "./app";
import { project, thread, snoozeSnapshot, archivedReady } from "./fixtures";
import type { rpcContract } from "./contract";

type Options = Omit<RenderSlotOptions, "rpc"> & {
  rpc?: Partial<NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>>;
};

const commands: PluginCommandRegistration[] = [];
// Capture through the public setup callback while retaining SDK registration validation.
const app = await loadPluginApp(
  definePluginApp((builder) =>
    definition.setup({
      ...builder,
      commands: {
        register(command) {
          commands.push(command);
          builder.commands.register(command);
        },
      },
    }),
  ),
);
const Owner = app.appOverlays[0]!.component;
const List = app.threadLists[0]!.component;
const context = (threadId: string | null = "t1"): PluginCommandContext => ({
  threadId,
  projectId: "p1",
  openPanel: () => false,
});
const available = (ctx = context()) =>
  commands.filter((command) => command.isAvailable!(ctx)).map(({ id }) => id);
const command = (id: string) => commands.find((entry) => entry.id === id)!;
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function mount(options: Options = {}, list = false, Observer?: ComponentType) {
  const { rpc, ...extras } = options;
  return renderSlot<{}, typeof rpcContract>(
    {
      component: () => (
        <>
          <Owner />
          {list ? (
            <List
              activeThreadId="t1"
              activeProjectId="p1"
              isCompactViewport={false}
              onNavigate={() => {}}
              searchQuery=""
            />
          ) : null}
          {Observer ? <Observer /> : null}
        </>
      ),
    },
    {},
    {
      ...extras,
      sidebarThreads: {
        threads: [thread()],
        projects: [project],
        experimental_archived: archivedReady,
        ...extras.sidebarThreads,
      },
      rpc: {
        listSnoozes: () => snoozeSnapshot(),
        listSummaries: () => ({ insightAvailable: true, summaries: {} }),
        snooze: () => ({}),
        wake: () => ({}),
        ...rpc,
      },
    },
  );
}
const calls = (slot: ReturnType<typeof renderSlot>, method: string) =>
  slot.inspection.rpcCalls.filter((call) => call.method === method);

it("registers three commands through the SDK and operates with only the headless owner mounted", async () => {
  expect(commands.map(({ id }) => id)).toEqual(["snooze-tomorrow", "snooze-next-week", "wake-now"]);
  expect(commands.every((entry) => !entry.defaultShortcut)).toBe(true);
  let snoozes: Record<string, number> = {};
  const slot = mount({
    rpc: {
      listSnoozes: () => snoozeSnapshot(snoozes),
      snooze: ({ threadId, wakeAt }) => {
        snoozes = { [threadId]: wakeAt };
        return {};
      },
      wake: () => {
        snoozes = {};
        return {};
      },
    },
  });
  await waitFor(() => expect(available()).toContain("snooze-tomorrow"));
  expect(slot.container.textContent).toBe("");
  await act(async () => command("snooze-tomorrow").run(context()));
  await waitFor(() => expect(available()).toEqual(["wake-now"]));
  expect(calls(slot, "listSnoozes")).toHaveLength(2);
  await act(async () => command("wake-now").run(context()));
  await waitFor(() => expect(available()).toContain("snooze-tomorrow"));
  expect(calls(slot, "wake").map(({ input }) => input)).toEqual([{ threadId: "t1" }]);
  expect(calls(slot, "listSnoozes")).toHaveLength(3);
  expect(slot.inspection.sdkCalls).toEqual([]);
  const beforeStop = slot.inspection.rpcCalls.length;
  slot.lifecycle.unmount();
  expect(available()).toEqual([]);
  await command("snooze-tomorrow").run(context());
  expect(slot.inspection.rpcCalls).toHaveLength(beforeStop);
});

it("excludes hidden focused threads without blocking an unrelated selected thread", async () => {
  let snoozes: Record<string, number> = {};
  const slot = mount(
    {
      context: { threadId: "t1", projectId: "p1" },
      sidebarThreads: {
        threads: [thread(), thread({ id: "t2", displayTitle: "Hidden", isHidden: true })],
        projects: [project],
      },
      rpc: {
        listSnoozes: () => snoozeSnapshot(snoozes),
        listSummaries: () => ({ insightAvailable: true, summaries: {} }),
        snooze: ({ threadId, wakeAt }) => {
          snoozes = { [threadId]: wakeAt };
          return {};
        },
      },
    },
    true,
  );
  await waitFor(() => expect(available(context("t1"))).toContain("snooze-tomorrow"));
  expect(slot.queryByRole("link", { name: "Hidden" })).toBeNull();
  expect(available(context("t2"))).toEqual([]);
  await act(async () => command("snooze-tomorrow").run(context("t2")));
  expect(calls(slot, "snooze")).toHaveLength(0);
  expect(available(context("t1"))).toContain("snooze-tomorrow");
  expect(calls(slot, "listSnoozes")).toHaveLength(1);
});

it("keeps the sidebar and commands in sync after snooze, wake, and another client's update", async () => {
  let snoozes: Record<string, number> = {};
  const slot = mount(
    {
      rpc: {
        listSnoozes: () => snoozeSnapshot(snoozes),
        listSummaries: () => ({ insightAvailable: true, summaries: {} }),
        snooze: ({ wakeAt }) => {
          snoozes = { t1: wakeAt };
          return {};
        },
        wake: () => {
          snoozes = {};
          return {};
        },
      },
    },
    true,
  );
  await waitFor(() => expect(available()).toContain("snooze-tomorrow"));
  expect(calls(slot, "listSnoozes")).toHaveLength(1);
  await act(async () => command("snooze-tomorrow").run(context()));
  await waitFor(() => expect(slot.queryByRole("link", { name: "Prepare release" })).toBeNull());
  fireEvent.click(slot.getByRole("tab", { name: "All" }));
  expect(slot.getByRole("button", { name: "Collapse Snoozed" })).toBeTruthy();
  expect(available()).toEqual(["wake-now"]);
  await act(async () => command("wake-now").run(context()));
  await waitFor(() => expect(slot.queryByRole("button", { name: "Collapse Snoozed" })).toBeNull());
  snoozes = { t1: Date.now() + 100_000 };
  await slot.behavior.emitRealtime("snoozes.changed", {});
  expect(available()).toEqual(["wake-now"]);
  expect(slot.getByRole("button", { name: "Collapse Snoozed" })).toBeTruthy();
  snoozes = {};
  await slot.behavior.emitRealtime("snoozes.changed", {});
  expect(available()).toContain("snooze-tomorrow");
  expect(slot.queryByRole("button", { name: "Collapse Snoozed" })).toBeNull();
});
describe("captured subtree in the sidebar", () => {
  const family = () => [
    thread({ status: "active", runtimeStatus: "active", isPinned: true, pinnedAt: 1 }),
    thread({ id: "child", displayTitle: "Child", parentThreadId: "t1" }),
    thread({ id: "grandchild", displayTitle: "Grandchild", parentThreadId: "child" }),
  ];

  it.each(["menu", "palette"] as const)(
    "snoozes the full tree through %s, and wakes it from the child's menu",
    async (entry) => {
      const rows = family();
      let stored = snoozeSnapshot();
      const slot = mount(
        {
          sidebarThreads: { threads: rows, projects: [project] },
          rpc: {
            listSnoozes: () => stored,
            snooze: ({ wakeAt }) => {
              stored = snoozeSnapshot(Object.fromEntries(rows.map(({ id }) => [id, wakeAt])), {
                t1: "family",
                child: "family",
                grandchild: "family",
              });
              return {};
            },
            wake: () => {
              stored = snoozeSnapshot();
              return {};
            },
          },
        },
        true,
      );
      await waitFor(() => expect(available()).toContain("snooze-tomorrow"));
      fireEvent.click(slot.getByRole("tab", { name: "In flight" }));
      if (entry === "menu") {
        fireEvent.click(slot.getByRole("button", { name: "Actions for Prepare release" }));
        fireEvent.click(slot.getByRole("menuitem", { name: "Tomorrow" }));
      } else await act(async () => command("snooze-tomorrow").run(context()));
      await waitFor(() => expect(available()).toEqual(["wake-now"]));
      expect(slot.queryAllByRole("link")).toHaveLength(0);
      fireEvent.click(slot.getByRole("tab", { name: "Needs attention" }));
      expect(slot.queryAllByRole("link")).toHaveLength(0);
      fireEvent.click(slot.getByRole("tab", { name: "All" }));
      expect(slot.getByRole("button", { name: "Collapse Snoozed" })).toBeTruthy();
      for (const name of ["Prepare release", "Child", "Grandchild"])
        expect(slot.getAllByRole("link", { name })).toHaveLength(1);
      expect(slot.queryByRole("button", { name: "Collapse Pinned" })).toBeNull();
      // The running parent's Working cue stays visible; idle members show the shared deadline.
      const wakeTimes = Array.from(slot.container.querySelectorAll('[title^="Snoozed until"]'));
      expect(wakeTimes).toHaveLength(2);
      expect(new Set(wakeTimes.map((time) => time.getAttribute("datetime"))).size).toBe(1);
      expect(slot.getByText("Working")).toBeTruthy();
      fireEvent.click(slot.getByRole("button", { name: "Collapse Snoozed" }));
      expect(slot.queryAllByRole("link")).toHaveLength(0);
      fireEvent.click(slot.getByRole("button", { name: "Expand Snoozed" }));
      fireEvent.click(slot.getByRole("button", { name: "Actions for Child" }));
      fireEvent.click(slot.getByRole("menuitem", { name: "Wake now" }));
      await waitFor(() =>
        expect(calls(slot, "wake").map(({ input }) => input)).toEqual([{ threadId: "child" }]),
      );
      await waitFor(() =>
        expect(slot.queryByRole("button", { name: "Collapse Snoozed" })).toBeNull(),
      );
      fireEvent.click(slot.getByRole("tab", { name: "In flight" }));
      for (const name of ["Prepare release", "Child", "Grandchild"])
        expect(slot.getAllByRole("link", { name })).toHaveLength(1);
      fireEvent.click(slot.getByRole("tab", { name: "Needs attention" }));
      expect(slot.queryAllByRole("link")).toHaveLength(0);
    },
  );

  it("restores the whole tree to Needs attention when a grouped grandchild asks for approval", async () => {
    const rows = family().map((row) =>
      row.id === "grandchild" ? { ...row, hasPendingInteraction: true } : row,
    );
    const later = Date.now() + 100_000;
    const slot = mount(
      {
        sidebarThreads: { threads: rows, projects: [project] },
        rpc: {
          listSnoozes: () =>
            snoozeSnapshot(
              { t1: later, child: later, grandchild: later },
              { t1: "g", child: "g", grandchild: "g" },
            ),
          wake: () => new Promise(() => {}),
        },
      },
      true,
    );
    await waitFor(() =>
      expect(calls(slot, "wake").map(({ input }) => input)).toEqual([{ threadId: "grandchild" }]),
    );
    for (const name of ["Prepare release", "Child", "Grandchild"])
      expect(slot.getAllByRole("link", { name })).toHaveLength(1);
    fireEvent.click(slot.getByRole("tab", { name: "In flight" }));
    expect(slot.queryAllByRole("link")).toHaveLength(0);
  });

  it("keeps a group snoozed when only a child's PR changes", async () => {
    const rows = family(),
      later = Date.now() + 100_000;
    let summaries = {};
    const slot = mount(
      {
        sidebarThreads: { threads: rows, projects: [project] },
        rpc: {
          listSnoozes: () =>
            snoozeSnapshot(
              { t1: later, child: later, grandchild: later },
              { t1: "g", child: "g", grandchild: "g" },
            ),
          listSummaries: () => ({ insightAvailable: true, summaries }),
        },
      },
      true,
    );
    await waitFor(() => expect(available()).toEqual(["wake-now"]));
    summaries = {
      child: {
        version: 1,
        updatedAt: new Date().toISOString(),
        pr: { number: 1, url: "https://example.com/pr/1", state: "open" },
        checks: { failed: 1, passed: 0, running: 0 },
        reviewers: { pending: 0 },
        blockers: ["checks_failed"],
      },
    };
    await slot.behavior.emitRealtime("summaries.changed", {});
    expect(calls(slot, "wake")).toHaveLength(0);
    expect(available()).toEqual(["wake-now"]);
    expect(slot.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("unavailable state and failures", () => {
  it.each(["loading", "error"] as const)(
    "hides all commands when thread state is %s",
    async (status) => {
      mount({ sidebarThreads: { threads: [thread()], status } });
      await act(async () => {});
      expect(available()).toEqual([]);
      await command("snooze-tomorrow").run(context());
    },
  );
  it.each(["snooze-tomorrow", "wake-now"])(
    "blocks %s in the first connected commit before its reload starts",
    async (id) => {
      const snoozed = { t1: Date.now() + 100_000 };
      const initial = id === "wake-now" ? snoozed : {};
      const refreshed = id === "wake-now" ? {} : snoozed;
      let finish!: (value: ReturnType<typeof snoozeSnapshot>) => void;
      const pending = new Promise<ReturnType<typeof snoozeSnapshot>>((resolve) => {
        finish = resolve;
      });
      let reads = 0;
      let visibleAtReconnect: string[] | undefined;
      let invocation: void | Promise<void>;
      function ObserveConnectedCommit() {
        const connection = useRealtimeConnectionState();
        const previous = useRef(connection);
        useLayoutEffect(() => {
          if (previous.current === "reconnecting" && connection === "connected") {
            visibleAtReconnect = available();
            invocation = command(id).run(context());
          }
          previous.current = connection;
        }, [connection]);
        return null;
      }
      const slot = mount(
        { rpc: { listSnoozes: () => (++reads === 1 ? snoozeSnapshot(initial) : pending) } },
        false,
        ObserveConnectedCommit,
      );
      await waitFor(() => expect(available()).toContain(id));
      await slot.behavior.setRealtimeConnectionState("reconnecting");
      await slot.behavior.setRealtimeConnectionState("connected");
      await invocation!;
      expect(visibleAtReconnect).toEqual([]);
      expect(calls(slot, "snooze")).toHaveLength(0);
      expect(calls(slot, "wake")).toHaveLength(0);
      expect(reads).toBe(2);
      await act(async () => finish(snoozeSnapshot(refreshed)));
      expect(available()).not.toContain(id);
    },
  );
  it("fails closed for an initial load, a failed refresh, and reconnect, then recovers", async () => {
    let fail = true;
    let result: Promise<ReturnType<typeof snoozeSnapshot>> | undefined;
    const slot = mount({
      rpc: {
        listSnoozes: () => {
          if (result) return result;
          if (fail) throw new Error("offline");
          return snoozeSnapshot();
        },
      },
    });
    await act(async () => {});
    expect(available()).toEqual([]);
    fail = false;
    await slot.behavior.emitRealtime("snoozes.changed", {});
    expect(available()).toContain("snooze-tomorrow");
    fail = true;
    await slot.behavior.emitRealtime("snoozes.changed", {});
    expect(available()).toEqual([]);
    fail = false;
    await slot.behavior.emitRealtime("snoozes.changed", {});
    expect(available()).toContain("snooze-tomorrow");
    let finish!: (value: ReturnType<typeof snoozeSnapshot>) => void;
    result = new Promise((resolve) => {
      finish = resolve;
    });
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    expect(available()).toEqual([]);
    await slot.behavior.setRealtimeConnectionState("connected");
    expect(available()).toEqual([]);
    await act(async () => finish(snoozeSnapshot()));
    expect(available()).toContain("snooze-tomorrow");
  });
  it.each([
    ["snooze-tomorrow", {}, "Could not snooze the thread."],
    ["wake-now", { t1: Date.now() + 100_000 }, "Could not wake the thread."],
  ] as const)(
    "shows failure without a successful local change for %s",
    async (id, snoozes, message) => {
      const error = vi.spyOn(toast, "error").mockImplementation(() => "toast");
      const slot = mount({
        rpc: {
          listSnoozes: () => snoozeSnapshot(snoozes),
          snooze: () => {
            throw new Error("offline");
          },
          wake: () => {
            throw new Error("offline");
          },
        },
      });
      await waitFor(() => expect(available()).toContain(id));
      const before = available();
      await act(async () => command(id).run(context()));
      expect(error).toHaveBeenCalledWith(message);
      expect(available()).toEqual(before);
      expect(calls(slot, "listSnoozes")).toHaveLength(1);
    },
  );
});
