import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { project, thread } from "./fixtures";
import {
  visibleItems,
  naturalTreePlacements,
  retainedTreePlacement,
  type TreePlacement,
  type ListOptions,
} from "./list-model";
import type { PrSummary } from "./pr-insight";

const options: ListOptions = {
  tab: "attention",
  mode: "project",
  sort: "title",
  direction: "asc",
  collapsedGroups: [],
  collapsedThreads: [],
};
const conflicts: PrSummary = {
  number: 42,
  url: "https://example.com/pull/42",
  state: "open",
  failedChecks: 0,
  passedChecks: 0,
  runningChecks: 0,
  waitingChecks: 0,
  pendingReviews: 0,
  blockers: ["conflicts"],
  failedNames: [],
  pendingNames: [],
  mergeQueue: null,
};
const prs = new Map([["problem", conflicts]]);
const activity = (changes: Partial<PluginSidebarThread["activity"]>) => ({
  workflows: 0,
  backgroundAgents: 0,
  backgroundCommands: 0,
  planMode: 0,
  goals: 0,
  ...changes,
});
const work: [string, Partial<PluginSidebarThread>][] = [
  ["starting", { status: "starting" }],
  ["running", { status: "active" }],
  ["stopping", { status: "stopping" }],
  ["a workflow", { activity: activity({ workflows: 1 }) }],
  ["a background agent", { activity: activity({ backgroundAgents: 1 }) }],
  ["a background command", { activity: activity({ backgroundCommands: 1 }) }],
  ["plan mode", { activity: activity({ planMode: 1 }) }],
  ["a goal", { activity: activity({ goals: 1 }) }],
  ["a queued message", { queuedWork: "waiting" }],
];
const directAttention: [string, Partial<PluginSidebarThread>][] = [
  ["an approval", { hasPendingInteraction: true }],
  ["input requested", { indicator: "waiting-for-input" }],
  ["an unread error", { indicator: "unread-error" }],
  ["a failed queued message", { queuedWork: "failed" }],
  ["a queued failure indicator", { indicator: "queued-failed" }],
];
const rows = (changes: Record<string, Partial<PluginSidebarThread>> = {}) => [
  thread({ id: "top", displayTitle: "A top", ...changes.top }),
  thread({ id: "mid", displayTitle: "B mid", parentThreadId: "top", ...changes.mid }),
  thread({ id: "leaf", displayTitle: "C leaf", parentThreadId: "mid", ...changes.leaf }),
  thread({ id: "problem", displayTitle: "D problem", parentThreadId: "top", ...changes.problem }),
];
const shape = (
  threads: PluginSidebarThread[],
  tab: "attention" | "inflight",
  summaries = prs,
  snoozed: ReadonlyMap<string, number> = new Map(),
) =>
  visibleItems(threads, [project], [], { ...options, tab }, summaries, snoozed)
    .filter((item) => item.kind === "thread")
    .map((item) => [item.id, item.depth, item.context]);
const tree = [
  ["top", 0, false],
  ["mid", 1, false],
  ["leaf", 2, false],
  ["problem", 1, false],
];

// The same public list derivation checks membership, nesting, and exclusivity.
describe("tree-wide tab priority", () => {
  describe.each(["top", "mid", "leaf"])("work at %s", (id) => {
    it.each(work)("keeps the conflicted tree in flight with %s", (_, changes) => {
      const threads = rows({ [id]: changes });
      expect(shape(threads, "attention")).toEqual([]);
      expect(shape(threads, "inflight")).toEqual(tree);
    });
  });

  describe.each(["top", "mid", "leaf"])("attention at %s", (id) => {
    it.each(directAttention)(
      "keeps the running, conflicted tree in Needs attention for %s",
      (_, changes) => {
        const threads = rows({ problem: { status: "active" }, [id]: changes });
        expect(shape(threads, "attention")).toEqual(tree);
        expect(shape(threads, "inflight")).toEqual([]);
      },
    );
  });

  const waiting: PrSummary = { ...conflicts, blockers: ["checks_running"], runningChecks: 1 };
  const waitingTop = new Map([
    ["top", waiting],
    ["problem", conflicts],
  ]);

  it.each([
    ["snoozed", {}, new Map([["excluded", 9_000]])],
    ["archived", { isArchived: true, archivedAt: 1 }, new Map<string, number>()],
    ["hidden", { isHidden: true }, new Map<string, number>()],
  ] as const)("ignores %s work when an awake child has conflicts", (_, changes, snoozed) => {
    const threads = [
      ...rows(),
      thread({ id: "excluded", parentThreadId: "mid", status: "active", ...changes }),
    ];
    expect(shape(threads, "attention", waitingTop, snoozed)).toEqual(tree);
    expect(shape(threads, "inflight", waitingTop, snoozed)).toEqual([]);
  });

  it.each([
    ["snoozed", {}, new Map([["top", 9_000]])],
    ["archived", { isArchived: true, archivedAt: 1 }, new Map<string, number>()],
  ] as const)("ignores a working %s ancestor rendered only as context", (_, changes, snoozed) => {
    const threads = rows({ top: { status: "active", ...changes } });
    expect(shape(threads, "attention", waitingTop, snoozed)).toEqual([
      ["top", 0, true],
      ["mid", 1, false],
      ["leaf", 2, false],
      ["problem", 1, false],
    ]);
    expect(shape(threads, "inflight", waitingTop, snoozed)).toEqual([]);
  });

  it("does not let work in an unrelated tree hide conflicts", () => {
    const threads = [
      ...rows(),
      thread({ id: "elsewhere", displayTitle: "Elsewhere", status: "active" }),
    ];
    expect(shape(threads, "attention", waitingTop)).toEqual(tree);
    expect(shape(threads, "inflight", waitingTop)).toEqual([["elsewhere", 0, false]]);
  });

  it.each(work)("returns to Needs attention when the last member stops %s", (_, changes) => {
    const working = rows({ mid: changes });
    expect(shape(working, "attention", waitingTop)).toEqual([]);
    expect(shape(working, "inflight", waitingTop)).toEqual(tree);
    const stopped = rows();
    expect(shape(stopped, "attention", waitingTop)).toEqual(tree);
    expect(shape(stopped, "inflight", waitingTop)).toEqual([]);
  });

  describe.each(["top", "mid", "leaf"])("unread output at %s", (id) => {
    it("keeps the tree in flight while another member works, then needs attention", () => {
      const working = rows({ problem: { status: "active" }, [id]: { isUnread: true } });
      expect(shape(working, "attention")).toEqual([]);
      expect(shape(working, "inflight")).toEqual(tree);
      const stopped = rows({ [id]: { isUnread: true } });
      expect(shape(stopped, "attention")).toEqual(tree);
      expect(shape(stopped, "inflight")).toEqual([]);
    });
  });

  it("keeps an unread launcher in flight while its child runs", () => {
    const threads = [
      thread({ id: "launcher", displayTitle: "Launcher", isUnread: true }),
      thread({
        id: "worker",
        displayTitle: "Worker",
        parentThreadId: "launcher",
        status: "active",
      }),
    ];
    const view = (tab: "attention" | "inflight") =>
      visibleItems(threads, [project], [], { ...options, tab }, new Map())
        .filter((item) => item.kind === "thread")
        .map((item) => item.id);
    expect(view("inflight")).toEqual(["launcher", "worker"]);
    expect(view("attention")).toEqual([]);
  });
});

describe("retained tree placement", () => {
  const attention: TreePlacement = { rootId: "top", parked: false, tab: "attention" };
  const inflight: TreePlacement = { rootId: "top", parked: false, tab: "inflight" };
  const other: TreePlacement = { rootId: "other", parked: false, tab: "attention" };
  const later: TreePlacement = { rootId: "top", parked: true, tab: "later" };
  const parkedInFlight: TreePlacement = { rootId: "top", parked: true, tab: "inflight" };
  const parkedNow: TreePlacement = { rootId: "top", parked: true, tab: "attention" };

  it("follows In flight when the selected tree leaves Now", () => {
    expect(retainedTreePlacement(inflight, attention, attention)).toEqual({
      heldTree: inflight,
      followFrom: "attention",
    });
    expect(retainedTreePlacement(inflight, undefined, attention)).toEqual({
      heldTree: inflight,
      followFrom: "attention",
    });
  });

  it("follows In flight when a selected parked tree starts work in Later", () => {
    expect(retainedTreePlacement(parkedInFlight, later, later)).toEqual({
      heldTree: parkedInFlight,
      followFrom: "later",
    });
  });

  it("keeps an In flight selection when the tree starts to need attention or finishes", () => {
    expect(retainedTreePlacement(attention, inflight, inflight)).toEqual({
      heldTree: inflight,
      followFrom: undefined,
    });
    expect(retainedTreePlacement(later, parkedInFlight, parkedInFlight)).toEqual({
      heldTree: parkedInFlight,
      followFrom: undefined,
    });
  });

  it("keeps a Later selection when the tree starts to need attention", () => {
    expect(retainedTreePlacement(parkedNow, later, later)).toEqual({
      heldTree: later,
      followFrom: undefined,
    });
  });

  it("drops the hold when the selected tree moves to Later or back to Now", () => {
    expect(retainedTreePlacement(later, attention, attention)).toEqual({
      heldTree: later,
      followFrom: undefined,
    });
    expect(retainedTreePlacement(attention, later, later)).toEqual({
      heldTree: attention,
      followFrom: undefined,
    });
  });

  it("uses the current placement for a newly selected tree", () => {
    expect(retainedTreePlacement(other, inflight, undefined)).toEqual({
      heldTree: other,
      followFrom: undefined,
    });
  });

  it("clears the hold when nothing is selected", () => {
    expect(retainedTreePlacement(undefined, inflight, attention)).toEqual({
      heldTree: undefined,
      followFrom: undefined,
    });
  });
});

describe("held tree placement", () => {
  it.each(["attention", "inflight"] as const)(
    "retains nesting only in the held %s tab without changing Later",
    (tab) => {
      const threads = rows(tab === "attention" ? { top: { status: "active" } } : {});
      const hold: TreePlacement = { rootId: "top", parked: false, tab };
      const other = tab === "attention" ? "inflight" : "attention";
      const list = (tab: ListOptions["tab"], heldTree?: TreePlacement) =>
        visibleItems(threads, [project], [], { ...options, tab }, prs, new Map(), heldTree);
      expect(
        list(tab, hold)
          .filter((item) => item.kind === "thread")
          .map((item) => [item.id, item.depth, item.context]),
      ).toEqual(tree);
      expect(list(other, hold)).toEqual([]);
      expect(list("later", hold)).toEqual([]);
      expect(list(tab)).toEqual([]);
      expect(list(other).filter((item) => item.kind === "thread")).toHaveLength(4);
    },
  );

  it("ignores a hold for another root or for the parked tree under the same root", () => {
    const threads = rows({ leaf: { hasPendingInteraction: true } });
    const list = (heldTree?: TreePlacement) =>
      visibleItems(threads, [project], [], options, prs, new Map(), heldTree);
    expect(list({ rootId: "missing", parked: false, tab: "inflight" })).toHaveLength(5);
    expect(list({ rootId: "top", parked: true, tab: "inflight" })).toEqual(list());
  });

  it("resolves eligible selections through hidden parents and loaded context ancestors", () => {
    const threads = rows({ top: { isArchived: true }, mid: { status: "active" } });
    const placements = naturalTreePlacements(threads, prs, new Map([["leaf", 9_000]]));
    expect([...placements.keys()]).toEqual(["mid", "problem"]);
    expect(placements.get("mid")).toEqual({ rootId: "top", parked: false, tab: "inflight" });
    const hidden = naturalTreePlacements(rows({ top: { isHidden: true } }), prs, new Map());
    expect(hidden.has("top")).toBe(false);
    expect(hidden.get("leaf")).toEqual({ rootId: "mid", parked: false, tab: "attention" });
  });
});
