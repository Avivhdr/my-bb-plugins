import { describe, expect, it } from "vitest";
import { thread } from "./fixtures";
import { listSnoozeThreads, snoozeThreadFromServer, subtreeMembers } from "./snooze-tree";
import { canSnoozeSubtree } from "./snooze-model";

const family = () => [
  thread({ id: "parent" }),
  thread({ id: "child", parentThreadId: "parent" }),
  thread({ id: "sibling", parentThreadId: "parent", projectId: "another-project" }),
  thread({ id: "grandchild", parentThreadId: "child" }),
  thread({ id: "unrelated" }),
];

describe("snooze subtree selection", () => {
  it("includes every depth without regard to project or rendered rows", () => {
    expect(
      subtreeMembers(family(), "parent")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["child", "grandchild", "parent", "sibling"]);
    expect(
      subtreeMembers(family(), "child")
        .map(({ id }) => id)
        .sort(),
    ).toEqual(["child", "grandchild"]);
  });

  it("traverses excluded intermediates without including them", () => {
    const rows = [
      thread({ id: "parent" }),
      thread({ id: "archived", parentThreadId: "parent", isArchived: true }),
      thread({ id: "hidden", parentThreadId: "archived", isHidden: true }),
      thread({ id: "grandchild", parentThreadId: "hidden" }),
    ];
    expect(subtreeMembers(rows, "parent").map(({ id }) => id)).toEqual(["parent", "grandchild"]);
  });

  it("terminates cycles and does not infer missing roots", () => {
    const rows = [
      thread({ id: "a", parentThreadId: "b" }),
      thread({ id: "b", parentThreadId: "a" }),
    ];
    expect(subtreeMembers(rows, "a")).toHaveLength(2);
    expect(subtreeMembers(rows, "missing")).toEqual([]);
    expect(canSnoozeSubtree([], "missing")).toBe(false);
  });

  it.each([
    { hasPendingInteraction: true },
    { indicator: "unread-error" as const },
    { queuedWork: "failed" as const },
  ])("blocks a parent when its grandchild needs the user: %o", (attention) => {
    const rows = family().map((row) => (row.id === "grandchild" ? { ...row, ...attention } : row));
    expect(canSnoozeSubtree(rows, "parent")).toBe(false);
    expect(canSnoozeSubtree(rows, "sibling")).toBe(true);
  });

  it("allows running children but not archived or hidden selections", () => {
    expect(
      canSnoozeSubtree(
        [
          thread({ id: "parent" }),
          thread({ id: "child", parentThreadId: "parent", status: "active" }),
        ],
        "parent",
      ),
    ).toBe(true);
    expect(canSnoozeSubtree([thread({ id: "archived", isArchived: true })], "archived")).toBe(
      false,
    );
    expect(canSnoozeSubtree([thread({ id: "hidden", isHidden: true })], "hidden")).toBe(false);
  });
});

describe("server hierarchy adapter", () => {
  it("uses the SDK's lifecycle and visibility fields", () => {
    expect(
      snoozeThreadFromServer({ id: "a", parentThreadId: "p", archivedAt: 1, visibility: "hidden" }),
    ).toEqual({ id: "a", parentThreadId: "p", isArchived: true, isHidden: true });
  });

  it("pages active and archived threads, including hidden relationship records", async () => {
    const calls: unknown[] = [];
    const list = async (
      args: { archived?: boolean; includeHidden?: boolean; limit?: number; offset?: number } = {},
    ) => {
      calls.push(args);
      const rows = Array.from({ length: args.archived ? 1 : 101 }, (_, i) => ({
        id: `${args.archived ? "archived" : "active"}-${i}`,
        parentThreadId: null,
        archivedAt: args.archived ? 1 : null,
        visibility: "visible" as const,
      }));
      return rows.slice(args.offset, (args.offset ?? 0) + (args.limit ?? 100));
    };
    const rows = await listSnoozeThreads({ list });
    expect(rows).toHaveLength(102);
    expect(calls).toEqual([
      { archived: false, includeHidden: true, limit: 100, offset: 0 },
      { archived: false, includeHidden: true, limit: 100, offset: 100 },
      { archived: true, includeHidden: true, limit: 100, offset: 0 },
    ]);
  });
});
