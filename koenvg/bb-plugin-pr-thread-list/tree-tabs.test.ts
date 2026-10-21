import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { project, thread } from "./fixtures";
import {
  visibleItems,
  naturalTreePlacements,
  type TreePlacement,
  type ListOptions,
} from "./list-model";
import type { PrSummary } from "./pr-insight";

const options: ListOptions = {
  tab: "attention",
  mode: "project",
  lifecycles: ["active"],
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
  ["unread output", { isUnread: true }],
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

  it("returns to In flight when unread output clears while conflicts and work remain", () => {
    const unread = rows({ top: { status: "active" }, leaf: { isUnread: true } });
    expect(shape(unread, "attention")).toEqual(tree);
    expect(shape(unread, "inflight")).toEqual([]);
    const read = rows({ top: { status: "active" } });
    expect(shape(read, "attention")).toEqual([]);
    expect(shape(read, "inflight")).toEqual(tree);
  });
});

describe("held tree placement", () => {
  it.each(["attention", "inflight"] as const)(
    "retains nesting only in the held %s tab without changing All",
    (tab) => {
      const threads = rows(tab === "attention" ? { top: { status: "active" } } : {});
      const hold: TreePlacement = { rootId: "top", tab };
      const other = tab === "attention" ? "inflight" : "attention";
      const list = (tab: ListOptions["tab"], heldTree?: TreePlacement) =>
        visibleItems(threads, [project], [], { ...options, tab }, prs, new Map(), heldTree);
      expect(
        list(tab, hold)
          .filter((item) => item.kind === "thread")
          .map((item) => [item.id, item.depth, item.context]),
      ).toEqual(tree);
      expect(list(other, hold)).toEqual([]);
      expect(list("all", hold)).toEqual(list("all"));
      expect(list(tab)).toEqual([]);
      expect(list(other).filter((item) => item.kind === "thread")).toHaveLength(4);
    },
  );

  it("ignores a hold for another root and keeps All's real Needs you grouping", () => {
    const threads = rows({ leaf: { hasPendingInteraction: true } });
    const hold: TreePlacement = { rootId: "top", tab: "inflight" };
    const list = (heldTree?: TreePlacement) =>
      visibleItems(threads, [project], [], { ...options, tab: "all" }, prs, new Map(), heldTree);
    expect(list(hold)).toEqual(list());
    expect(list(hold)[0]).toMatchObject({ kind: "group", label: "Needs you" });
    expect(
      visibleItems(threads, [project], [], options, prs, new Map(), {
        rootId: "missing",
        tab: "inflight",
      }),
    ).toHaveLength(5);
  });

  it("resolves eligible selections through hidden parents and loaded context ancestors", () => {
    const threads = rows({ top: { isArchived: true }, mid: { status: "active" } });
    const placements = naturalTreePlacements(threads, prs, new Map([["leaf", 9_000]]));
    expect([...placements.keys()]).toEqual(["mid", "problem"]);
    expect(placements.get("mid")).toEqual({ rootId: "top", tab: "inflight" });
    const hidden = naturalTreePlacements(rows({ top: { isHidden: true } }), prs, new Map());
    expect(hidden.has("top")).toBe(false);
    expect(hidden.get("leaf")).toEqual({ rootId: "mid", tab: "attention" });
  });
});
