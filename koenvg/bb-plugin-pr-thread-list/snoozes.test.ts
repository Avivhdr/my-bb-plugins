import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { Snoozes } from "./contract";
import { SNOOZE_WAKE_SCHEDULE } from "./snoozes";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
const NOW = new Date("2026-10-07T15:00:00").getTime();
const HOUR = 3_600_000;

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
];
function setup(
  options: {
    markUnread?: (args: { threadId: string }) => Promise<unknown>;
    rows?: ReturnType<typeof row>[];
    databasePath?: string;
  } = {},
) {
  const rows =
    options.rows ??
    ["thr_1", "thr_due", "thr_also_due", "thr_later", "thr_gone"].map((id) => row(id));
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
          return makeThreadResponse({ id: threadId, archivedAt: found.archivedAt });
        },
        markRead: async () => ({}),
        markUnread: options.markUnread ?? (async () => ({})),
      },
    } as never,
  });
  if (options.databasePath) {
    const db = new Database(options.databasePath);
    bb.onDispose(() => {
      db.close();
    });
    plugin({ ...bb, storage: { ...bb.storage, database: () => db } });
  } else plugin(bb);
  return harness;
}
type Harness = ReturnType<typeof setup>;
const changes = (harness: Harness) =>
  harness.realtimeSignals.filter((signal) => signal.channel === "snoozes.changed");
const list = (harness: Harness) =>
  harness.callRpc("listSnoozes", {}).then((result) => ({ snoozes: (result as Snoozes).snoozes }));
const thread = (id: string) => ({ thread: { id } }) as never;

describe("snoozes", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks the thread read, stores the wake time, and publishes", async () => {
    const harness = setup();

    await harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + HOUR });

    expect(harness.sdk.callsTo("threads.markRead")).toEqual([[{ threadId: "thr_1" }]]);
    await expect(list(harness)).resolves.toEqual({ snoozes: { thr_1: NOW + HOUR } });
    expect(changes(harness)).toHaveLength(1);
  });

  it("rejects a wake time in the past or more than 30 days ahead", async () => {
    const harness = setup();

    await expect(harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW })).rejects.toThrow(
      /30 days/,
    );
    await expect(
      harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + 31 * 24 * HOUR }),
    ).rejects.toThrow(/30 days/);
    expect(harness.sdk.callsTo("threads.markRead")).toEqual([]);
    await expect(list(harness)).resolves.toEqual({ snoozes: {} });
  });

  it("does not store the snooze when the thread cannot be marked read", async () => {
    const harness = setup();
    harness.sdk.stub("threads.markRead", async () => {
      throw new Error("not found");
    });

    await expect(
      harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + HOUR }),
    ).rejects.toThrow();
    await expect(list(harness)).resolves.toEqual({ snoozes: {} });
  });

  it("ends a snooze on wake and publishes", async () => {
    const harness = setup();
    await harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + HOUR });

    await harness.callRpc("wake", { threadId: "thr_1" });

    await expect(list(harness)).resolves.toEqual({ snoozes: {} });
    expect(changes(harness)).toHaveLength(2);
    expect(harness.sdk.callsTo("threads.markUnread")).toEqual([]);
  });

  it("publishes nothing on wake for a thread that is not snoozed", async () => {
    const harness = setup();

    await harness.callRpc("wake", { threadId: "thr_1" });

    expect(changes(harness)).toEqual([]);
  });

  it("runs the wake sweep every minute", () => {
    const harness = setup();

    expect(harness.registrations.schedules.map(({ name, cron }) => ({ name, cron }))).toEqual([
      { name: SNOOZE_WAKE_SCHEDULE, cron: "* * * * *" },
    ]);
  });

  it("marks due threads unread, ends their snoozes, and publishes once", async () => {
    const harness = setup();
    await harness.callRpc("snooze", { threadId: "thr_due", wakeAt: NOW + HOUR });
    await harness.callRpc("snooze", { threadId: "thr_also_due", wakeAt: NOW + 2 * HOUR });
    await harness.callRpc("snooze", { threadId: "thr_later", wakeAt: NOW + 3 * HOUR });
    vi.setSystemTime(NOW + 2 * HOUR);

    await harness.runSchedule(SNOOZE_WAKE_SCHEDULE);

    expect(harness.sdk.callsTo("threads.markUnread").flat()).toEqual(
      expect.arrayContaining([{ threadId: "thr_due" }, { threadId: "thr_also_due" }]),
    );
    expect(harness.sdk.callsTo("threads.markUnread")).toHaveLength(2);
    await expect(list(harness)).resolves.toEqual({ snoozes: { thr_later: NOW + 3 * HOUR } });
    expect(changes(harness)).toHaveLength(4);
  });

  it("does nothing in a sweep when no snooze is due", async () => {
    const harness = setup();
    await harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + HOUR });

    await harness.runSchedule(SNOOZE_WAKE_SCHEDULE);

    expect(harness.sdk.callsTo("threads.markUnread")).toEqual([]);
    expect(changes(harness)).toHaveLength(1);
  });

  it("serializes a replacement snooze after an in-flight deadline unread update", async () => {
    let finishMarkUnread: () => void = () => {};
    const harness = setup({
      markUnread: () =>
        new Promise<unknown>((resolve) => {
          finishMarkUnread = () => resolve({});
        }),
    });
    await harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + HOUR });
    vi.setSystemTime(NOW + HOUR);

    const sweep = harness.runSchedule(SNOOZE_WAKE_SCHEDULE);
    await vi.waitFor(() => expect(harness.sdk.callsTo("threads.markUnread")).toHaveLength(1));
    let replaced = false;
    const replacement = harness
      .callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + 5 * HOUR })
      .then(() => {
        replaced = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const replacedBeforeUnread = replaced;
    finishMarkUnread();
    await Promise.all([sweep, replacement]);

    expect(replacedBeforeUnread).toBe(false);
    await expect(list(harness)).resolves.toEqual({ snoozes: { thr_1: NOW + 5 * HOUR } });
    expect(harness.sdk.callsTo("threads.markRead")).toHaveLength(2);
  });

  it("ends the snooze of a deleted thread in a sweep", async () => {
    const harness = setup({
      markUnread: async () => {
        throw new Error("thread not found");
      },
    });
    await harness.callRpc("snooze", { threadId: "thr_gone", wakeAt: NOW + HOUR });
    vi.setSystemTime(NOW + HOUR);

    await harness.runSchedule(SNOOZE_WAKE_SCHEDULE);

    await expect(list(harness)).resolves.toEqual({ snoozes: {} });
    expect(changes(harness)).toHaveLength(2);
  });

  it.each(["thread.idle", "thread.failed", "thread.archived", "thread.unarchived"] as const)(
    "ends a snooze on %s",
    async (event) => {
      const harness = setup();
      await harness.callRpc("snooze", { threadId: "thr_1", wakeAt: NOW + HOUR });

      await harness.emitThreadEvent(event, thread("thr_1"));

      await expect(list(harness)).resolves.toEqual({ snoozes: {} });
      expect(changes(harness)).toHaveLength(2);
    },
  );

  it("publishes nothing on a thread event for a thread that is not snoozed", async () => {
    const harness = setup();

    await harness.emitThreadEvent("thread.idle", thread("thr_1"));

    expect(changes(harness)).toEqual([]);
  });
  it("captures descendants, overrides older snoozes, and marks every member read", async () => {
    const rows = [
      ...family,
      row("archived", "parent", NOW),
      row("hidden", "archived", null, "hidden"),
      row("deep", "hidden"),
    ];
    const harness = setup({ rows });
    await harness.callRpc("snooze", { threadId: "child", wakeAt: NOW + 9 * HOUR });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    const result = (await harness.callRpc("listSnoozes", {})) as Snoozes;
    expect(result.snoozes).toEqual({
      parent: NOW + HOUR,
      child: NOW + HOUR,
      grandchild: NOW + HOUR,
      sibling: NOW + HOUR,
      deep: NOW + HOUR,
    });
    expect(new Set(Object.values(result.groups)).size).toBe(1);
    expect(harness.sdk.callsTo("threads.markRead").flat()).toEqual(
      expect.arrayContaining(
        ["parent", "child", "grandchild", "sibling", "deep"].map((threadId) => ({ threadId })),
      ),
    );
    expect(harness.sdk.callsTo("threads.markRead").flat()).not.toContainEqual({
      threadId: "hidden",
    });
    expect(changes(harness)).toHaveLength(2);
    rows.push(row("new-child", "parent"));
    await harness.emitThreadEvent("thread.failed", thread("new-child"));
    expect((await list(harness)).snoozes).toEqual(result.snoozes);
  });

  it("does not persist or publish a partial group after a later read fails", async () => {
    const harness = setup({ rows: family });
    await harness.callRpc("snooze", { threadId: "child", wakeAt: NOW + 9 * HOUR });
    const before = await harness.callRpc("listSnoozes", {});
    harness.sdk.stub("threads.markRead", async ({ threadId }: { threadId: string }) => {
      if (threadId === "child") throw new Error("cannot mark child read");
      return {};
    });
    await expect(
      harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR }),
    ).rejects.toThrow();
    expect(await harness.callRpc("listSnoozes", {})).toEqual(before);
    expect(changes(harness)).toHaveLength(1);
  });

  it.each(["manual", "thread.idle", "thread.failed"] as const)(
    "wakes the entire stored group on a grandchild %s",
    async (event) => {
      const harness = setup({ rows: family });
      await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
      await harness.callRpc("snooze", { threadId: "other", wakeAt: NOW + HOUR });
      if (event === "manual") await harness.callRpc("wake", { threadId: "grandchild" });
      else await harness.emitThreadEvent(event, thread("grandchild"));
      expect((await list(harness)).snoozes).toEqual({ other: NOW + HOUR });
      expect(harness.sdk.callsTo("threads.markUnread")).toEqual([]);
      expect(changes(harness)).toHaveLength(3);
    },
  );

  it("preserves membership through restart and wakes overdue groups", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "snooze-restart-"));
    const databasePath = join(dataDir, "snoozes.db");
    let harness = setup({ rows: family, databasePath });
    try {
      await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
      await harness.lifecycle.dispose();
      harness = setup({ rows: family, databasePath });
      await harness.emitThreadEvent("thread.failed", thread("child"));
      expect((await list(harness)).snoozes).toEqual({});
      await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
      await harness.lifecycle.dispose();
      vi.setSystemTime(NOW + 2 * HOUR);
      harness = setup({ rows: family, databasePath });
      await harness.runSchedule(SNOOZE_WAKE_SCHEDULE);
      expect((await list(harness)).snoozes).toEqual({});
      expect(harness.sdk.callsTo("threads.markUnread")).toHaveLength(4);
    } finally {
      await harness.lifecycle.dispose();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it.each(["thread.idle", "thread.failed"] as const)(
    "does not lose %s during pending read updates",
    async (event) => {
      const harness = setup({ rows: family });
      harness.sdk.stub("threads.markRead", async ({ threadId }: { threadId: string }) => {
        if (threadId === "child") await harness.emitThreadEvent(event, thread("child"));
        return {};
      });
      await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
      expect((await list(harness)).snoozes).toEqual({});
    },
  );

  it("removes only an archived member, including during pending reads", async () => {
    const harness = setup({ rows: family });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    await harness.emitThreadEvent("thread.archived", thread("parent"));
    await harness.emitThreadEvent("thread.unarchived", thread("parent"));
    expect((await list(harness)).snoozes).toEqual({
      child: NOW + HOUR,
      grandchild: NOW + HOUR,
      sibling: NOW + HOUR,
    });
    await harness.callRpc("wake", { threadId: "grandchild" });
    harness.sdk.stub("threads.markRead", async ({ threadId }: { threadId: string }) => {
      if (threadId === "child") await harness.emitThreadEvent("thread.archived", thread("child"));
      return {};
    });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    expect((await list(harness)).snoozes).toEqual({
      parent: NOW + HOUR,
      grandchild: NOW + HOUR,
      sibling: NOW + HOUR,
    });
  });

  it("wakes remaining members at the deadline even if one is deleted or archived", async () => {
    const rows = [...family];
    const harness = setup({ rows });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    rows.splice(
      rows.findIndex(({ id }) => id === "child"),
      1,
    );
    rows[rows.findIndex(({ id }) => id === "sibling")] = row("sibling", "parent", NOW);
    vi.setSystemTime(NOW + HOUR);
    await harness.runSchedule(SNOOZE_WAKE_SCHEDULE);
    expect((await list(harness)).snoozes).toEqual({});
    expect(harness.sdk.callsTo("threads.markUnread").flat()).toEqual(
      expect.arrayContaining([{ threadId: "parent" }, { threadId: "grandchild" }]),
    );
    expect(harness.sdk.callsTo("threads.markUnread")).toHaveLength(2);
  });
  it("does not let an old grouped sweep leave a replacement group unread", async () => {
    const read = new Map<string, boolean>();
    let finishUnread: () => void = () => {};
    const harness = setup({
      rows: family,
      markUnread: async ({ threadId }) => {
        if (threadId === "child")
          await new Promise<void>((resolve) => {
            finishUnread = resolve;
          });
        read.set(threadId, false);
        return {};
      },
    });
    harness.sdk.stub("threads.markRead", async ({ threadId }: { threadId: string }) => {
      read.set(threadId, true);
      return {};
    });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    vi.setSystemTime(NOW + HOUR);
    const sweep = harness.runSchedule(SNOOZE_WAKE_SCHEDULE);
    await vi.waitFor(() =>
      expect(harness.sdk.callsTo("threads.markUnread")).toContainEqual([{ threadId: "child" }]),
    );
    const replacement = harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + 5 * HOUR });
    await new Promise<void>((resolve) => setImmediate(resolve));
    finishUnread();
    await Promise.all([sweep, replacement]);
    expect((await list(harness)).snoozes).toEqual({
      parent: NOW + 5 * HOUR,
      child: NOW + 5 * HOUR,
      grandchild: NOW + 5 * HOUR,
      sibling: NOW + 5 * HOUR,
    });
    expect([...read.values()]).toEqual([true, true, true, true]);
  });

  it("skips captured deadline members after a manual wake during lookup", async () => {
    const harness = setup({ rows: family });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    harness.sdk.stub("threads.get", async ({ threadId }: { threadId: string }) => {
      await harness.callRpc("wake", { threadId });
      return makeThreadResponse({ id: threadId });
    });
    vi.setSystemTime(NOW + HOUR);
    await harness.runSchedule(SNOOZE_WAKE_SCHEDULE);
    expect(harness.sdk.callsTo("threads.markUnread")).toEqual([]);
    expect((await list(harness)).snoozes).toEqual({});
  });

  it.each(["thread.idle", "thread.failed"] as const)(
    "does not lose %s while hierarchy pages load",
    async (event) => {
      const harness = setup({ rows: family });
      harness.sdk.stub("threads.list", async ({ archived }: { archived: boolean }) => {
        if (archived) {
          await harness.emitThreadEvent(event, thread("child"));
          return [];
        }
        return family;
      });
      await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
      expect((await list(harness)).snoozes).toEqual({});
    },
  );

  it("ignores outside-subtree terminal events during hierarchy loading", async () => {
    const harness = setup({ rows: family });
    harness.sdk.stub("threads.list", async ({ archived }: { archived: boolean }) => {
      if (archived) {
        await harness.emitThreadEvent("thread.failed", thread("other"));
        return [];
      }
      return family;
    });
    await harness.callRpc("snooze", { threadId: "child", wakeAt: NOW + HOUR });
    expect((await list(harness)).snoozes).toEqual({ child: NOW + HOUR, grandchild: NOW + HOUR });
  });

  it("does not capture a member removed during hierarchy loading", async () => {
    const harness = setup({ rows: family });
    harness.sdk.stub("threads.list", async ({ archived }: { archived: boolean }) => {
      if (archived) {
        await harness.emitThreadEvent("thread.archived", thread("child"));
        return [];
      }
      return family;
    });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    expect((await list(harness)).snoozes).toEqual({
      parent: NOW + HOUR,
      grandchild: NOW + HOUR,
      sibling: NOW + HOUR,
    });
    expect(harness.sdk.callsTo("threads.markRead")).not.toContainEqual([{ threadId: "child" }]);
  });
  it("captures terminal signals while a snooze waits behind a sweep", async () => {
    let finishUnread: () => void = () => {};
    const harness = setup({
      rows: family,
      markUnread: async ({ threadId }) => {
        if (threadId === "child")
          await new Promise<void>((resolve) => {
            finishUnread = resolve;
          });
        return {};
      },
    });
    await harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR });
    vi.setSystemTime(NOW + HOUR);
    const sweep = harness.runSchedule(SNOOZE_WAKE_SCHEDULE);
    await vi.waitFor(() => expect(harness.sdk.callsTo("threads.markUnread")).toHaveLength(1));
    const replacement = harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + 5 * HOUR });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await harness.emitThreadEvent("thread.failed", thread("child"));
    finishUnread();
    await Promise.all([sweep, replacement]);
    expect((await list(harness)).snoozes).toEqual({});
  });

  it("releases the mutation queue after a failed read update", async () => {
    const harness = setup({ rows: family });
    harness.sdk.stub("threads.markRead", async ({ threadId }: { threadId: string }) => {
      if (threadId === "child") throw new Error("cannot mark read");
      return {};
    });
    await expect(
      harness.callRpc("snooze", { threadId: "parent", wakeAt: NOW + HOUR }),
    ).rejects.toThrow("cannot mark read");
    await harness.callRpc("snooze", { threadId: "other", wakeAt: NOW + HOUR });
    expect((await list(harness)).snoozes).toEqual({ other: NOW + HOUR });
  });
});
