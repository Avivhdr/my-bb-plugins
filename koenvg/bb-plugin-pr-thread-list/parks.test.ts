import { describe, expect, it } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import type { Parks } from "./contract";
import { lineage } from "./parks";

const row = (
  id: string,
  parentThreadId: string | null = null,
  archivedAt: number | null = null,
  visibility: "visible" | "hidden" = "visible",
) => ({ id, parentThreadId, archivedAt, visibility });
const family = [
  row("parent"),
  row("child", "parent"),
  row("grandchild", "child"),
  row("sibling", "parent"),
  row("other"),
  row("gone", null, 1),
  row("secret", null, null, "hidden"),
];

function setup(rows = family) {
  const { bb, harness } = createFakePluginHost({
    pluginId: "pr-thread-list",
    sdk: {
      threads: {
        list: async ({
          archived,
          offset = 0,
          limit = 100,
        }: {
          archived: boolean;
          offset?: number;
          limit?: number;
        }) =>
          rows
            .filter((row) => (row.archivedAt !== null) === archived)
            .slice(offset, offset + limit),
        get: async ({ threadId }: { threadId: string }) => {
          const found = rows.find(({ id }) => id === threadId);
          if (!found) throw new Error("not found");
          return makeThreadResponse({
            id: threadId,
            archivedAt: found.archivedAt,
            visibility: found.visibility,
          });
        },
      },
    } as never,
  });
  plugin(bb);
  return harness;
}
type Harness = ReturnType<typeof setup>;
const list = (harness: Harness) =>
  harness.callRpc("listParks", {}).then((result) => (result as Parks).threadIds);
const changes = (harness: Harness) =>
  harness.realtimeSignals.filter((signal) => signal.channel === "parks.changed");

describe("parks", () => {
  it("stores a parked thread once and publishes", async () => {
    const harness = setup();
    await harness.callRpc("park", { threadId: "child" });
    await harness.callRpc("park", { threadId: "child" });
    await expect(list(harness)).resolves.toEqual(["child"]);
    expect(changes(harness)).toHaveLength(1);
  });

  it("refuses archived, hidden, and unknown threads", async () => {
    const harness = setup();
    for (const threadId of ["gone", "secret", "missing"])
      await expect(harness.callRpc("park", { threadId })).rejects.toThrow();
    await expect(list(harness)).resolves.toEqual([]);
  });

  it("brings back the thread's ancestors and descendants, but not unrelated threads", async () => {
    const harness = setup();
    for (const threadId of ["parent", "grandchild", "other"])
      await harness.callRpc("park", { threadId });
    await harness.callRpc("unpark", { threadId: "child" });
    await expect(list(harness)).resolves.toEqual(["other"]);
  });

  it("does not publish when nothing was parked", async () => {
    const harness = setup();
    await harness.callRpc("unpark", { threadId: "other" });
    expect(changes(harness)).toHaveLength(0);
  });

  it("forgets archived and deleted threads", async () => {
    const harness = setup();
    await harness.callRpc("park", { threadId: "parent" });
    await harness.callRpc("park", { threadId: "other" });
    await harness.emitThreadEvent("thread.archived", { thread: { id: "parent" } } as never);
    await harness.emitThreadEvent("thread.deleted", { thread: { id: "other" } } as never);
    await expect(list(harness)).resolves.toEqual([]);
  });
});

describe("lineage", () => {
  it("follows parents up and children down, and survives a cycle", () => {
    const threads = family.map((r) => ({
      id: r.id,
      parentThreadId: r.parentThreadId,
      isArchived: r.archivedAt !== null,
      isHidden: r.visibility === "hidden",
    }));
    expect(lineage(threads, "child").sort()).toEqual(["child", "grandchild", "parent"]);
    const loop = [
      { id: "a", parentThreadId: "b", isArchived: false, isHidden: false },
      { id: "b", parentThreadId: "a", isArchived: false, isHidden: false },
    ];
    expect(lineage(loop, "a").sort()).toEqual(["a", "b"]);
  });
});
