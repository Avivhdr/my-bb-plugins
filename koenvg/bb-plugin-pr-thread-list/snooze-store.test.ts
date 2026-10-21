import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSnoozeStore, SNOOZE_MIGRATIONS } from "./snooze-store";
import { rpcContract } from "./contract";

const open = () => {
  const db = new Database(":memory:");
  for (const migration of SNOOZE_MIGRATIONS) db.exec(migration);
  return db;
};

describe("snooze store", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createSnoozeStore>;
  beforeEach(() => {
    db = open();
    store = createSnoozeStore(db);
  });
  afterEach(() => db.close());

  it("replaces selected rows together and preserves unrelated groups with the same deadline", () => {
    store.replaceGroup(["child", "grandchild"], 9_000, 1_000);
    const unrelated = store.replaceGroup(["other"], 2_000, 1_000);
    const group = store.replaceGroup(["parent", "child", "grandchild"], 2_000, 1_500);
    expect(store.snapshot()).toEqual({
      snoozes: { parent: 2_000, child: 2_000, grandchild: 2_000, other: 2_000 },
      groups: { parent: group, child: group, grandchild: group, other: unrelated },
    });
    expect(store.endGroup("grandchild")).toBe(true);
    expect(store.endGroup("grandchild")).toBe(false);
    expect(store.snapshot().snoozes).toEqual({ other: 2_000 });
  });

  it("removes only an archived member, even the original root", () => {
    const group = store.replaceGroup(["parent", "child", "grandchild"], 2_000, 1_000);
    expect(store.delete("parent")).toBe(true);
    expect(store.due(2_000)).toEqual([
      { id: group, wakeAt: 2_000, threadIds: ["child", "grandchild"] },
    ]);
    store.endGroup("child");
    expect(store.snapshot().snoozes).toEqual({});
  });

  it("does not remove newer snoozes, even if they also become due before an older sweep finishes", () => {
    const old = store.replaceGroup(["parent", "child"], 2_000, 1_000);
    const replacement = store.replaceGroup(["parent", "child"], 3_000, 2_500);
    expect(store.deleteDue(old, 4_000)).toBe(false);
    expect(store.snapshot().groups).toEqual({ parent: replacement, child: replacement });
    expect(store.deleteDue(replacement, 4_000)).toBe(true);
  });

  it("selects due groups once, not each member", () => {
    const group = store.replaceGroup(["parent", "child"], 2_000, 1_000);
    store.replaceGroup(["later"], 3_000, 1_000);
    expect(store.due(2_000)).toEqual([
      { id: group, wakeAt: 2_000, threadIds: ["child", "parent"] },
    ]);
  });

  it("preserves captured membership across store recreation", () => {
    const group = store.replaceGroup(["parent", "child"], 2_000, 1_000);
    expect(createSnoozeStore(db).snapshot().groups).toEqual({ parent: group, child: group });
  });
});

describe("group membership migration", () => {
  it("preserves old deadlines/read timestamps and upgrades later old-version inserts as singletons", () => {
    const db = new Database(":memory:");
    try {
      db.exec(SNOOZE_MIGRATIONS[0]!);
      const oldInsert = db.prepare(
        "INSERT INTO snoozes (thread_id, wake_at, snoozed_at) VALUES (?, ?, ?)",
      );
      oldInsert.run("old", 2_000, 1_000);
      for (const migration of SNOOZE_MIGRATIONS.slice(1)) db.exec(migration);
      const store = createSnoozeStore(db);
      const oldGroup = store.snapshot().groups.old;
      oldInsert.run("rollback", 2_000, 1_000);
      const upgraded = createSnoozeStore(db);
      expect(upgraded.snapshot().snoozes).toEqual({ old: 2_000, rollback: 2_000 });
      expect(upgraded.snapshot().groups.old).toBe(oldGroup);
      expect(upgraded.snapshot().groups.rollback).not.toBe(oldGroup);
      expect(db.prepare("SELECT snoozed_at FROM snoozes WHERE thread_id = 'old'").get()).toEqual({
        snoozed_at: 1_000,
      });
      upgraded.endGroup("old");
      expect(upgraded.snapshot().snoozes).toEqual({ rollback: 2_000 });
    } finally {
      db.close();
    }
  });
  it.each([3_000, 2_000])(
    "repairs an old-version update to a grouped member with deadline %s",
    (wakeAt) => {
      const db = open();
      try {
        const store = createSnoozeStore(db);
        store.replaceGroup(["parent", "child", "grandchild"], 2_000, 1_000);
        const unrelated = store.replaceGroup(["other"], 4_000, 1_000);
        db.prepare(`INSERT INTO snoozes (thread_id, wake_at, snoozed_at) VALUES (?, ?, ?)
        ON CONFLICT (thread_id) DO UPDATE SET wake_at = excluded.wake_at, snoozed_at = excluded.snoozed_at`).run(
          "child",
          wakeAt,
          1_500,
        );
        const upgraded = createSnoozeStore(db);
        expect(upgraded.snapshot().snoozes).toEqual({
          parent: 2_000,
          child: wakeAt,
          grandchild: 2_000,
          other: 4_000,
        });
        expect(
          new Set(["parent", "child", "grandchild"].map((id) => upgraded.snapshot().groups[id]))
            .size,
        ).toBe(3);
        expect(upgraded.snapshot().groups.other).toBe(unrelated);
        expect(
          db.prepare("SELECT snoozed_at FROM snoozes WHERE thread_id = 'child'").get(),
        ).toEqual({ snoozed_at: 1_500 });
        expect(rpcContract.listSnoozes.output.safeParse(upgraded.snapshot()).success).toBe(true);
        upgraded.endGroup("child");
        expect(upgraded.snapshot().snoozes).toEqual({
          parent: 2_000,
          grandchild: 2_000,
          other: 4_000,
        });
      } finally {
        db.close();
      }
    },
  );
});
