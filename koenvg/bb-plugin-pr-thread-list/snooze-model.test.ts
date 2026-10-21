import { describe, expect, it } from "vitest";
import { thread } from "./fixtures";
import { activeSnoozes, snoozePresets, snoozesToEnd, wakeLabel } from "./snooze-model";

process.env.TZ = "Europe/Brussels";

const at = (year: number, month: number, day: number, hour = 15) =>
  new Date(year, month - 1, day, hour);
const presets = (now: Date) =>
  snoozePresets(now).map(({ label, wakeAt }) => [label, new Date(wakeAt).toString()]);

describe("snoozePresets", () => {
  it("wakes tomorrow and next Monday at 9:00 on a Wednesday", () => {
    expect(presets(at(2026, 10, 7))).toEqual([
      ["Tomorrow", at(2026, 10, 8, 9).toString()],
      ["Next week", at(2026, 10, 12, 9).toString()],
    ]);
  });

  it("wakes on Saturday when snoozed until tomorrow on a Friday", () => {
    expect(presets(at(2026, 10, 9))[0]).toEqual(["Tomorrow", at(2026, 10, 10, 9).toString()]);
  });

  it("wakes seven days later when snoozed until next week on a Monday morning", () => {
    expect(presets(at(2026, 10, 5, 8))[1]).toEqual(["Next week", at(2026, 10, 12, 9).toString()]);
  });

  it("offers only tomorrow on a Sunday", () => {
    expect(presets(at(2026, 10, 11))).toEqual([["Tomorrow", at(2026, 10, 12, 9).toString()]]);
  });

  it("keeps 9:00 local time across a daylight saving change", () => {
    const [tomorrow] = snoozePresets(at(2026, 10, 24));

    expect(new Date(tomorrow!.wakeAt).getHours()).toBe(9);
    expect(new Date(tomorrow!.wakeAt).getDate()).toBe(25);
  });
});

describe("wakeLabel", () => {
  it("shows a short weekday and the time", () => {
    expect(wakeLabel(at(2026, 10, 13, 9).getTime())).toBe("Tue 9:00");
  });
});

describe("activeSnoozes", () => {
  const now = at(2026, 10, 7).getTime();
  const later = now + 3_600_000;

  it("keeps snoozes whose wake time is still ahead", () => {
    expect(activeSnoozes([thread({ id: "t1" })], { t1: later }, now)).toEqual(
      new Map([["t1", later]]),
    );
  });

  it("drops a snooze whose wake time has passed", () => {
    expect(activeSnoozes([thread({ id: "t1" })], { t1: now }, now).size).toBe(0);
  });

  it("drops a snooze of a thread that needs the user or is archived", () => {
    const threads = [
      thread({ id: "asks", hasPendingInteraction: true }),
      thread({ id: "failed", indicator: "unread-error" }),
      thread({ id: "archived", isArchived: true }),
    ];

    expect(activeSnoozes(threads, { asks: later, failed: later, archived: later }, now).size).toBe(
      0,
    );
  });

  it("ignores snoozes of threads that are not in the list", () => {
    expect(activeSnoozes([], { gone: later }, now).size).toBe(0);
  });
});

describe("snoozesToEnd", () => {
  it("names snoozed threads that need the user", () => {
    const threads = [
      thread({ id: "asks", hasPendingInteraction: true }),
      thread({ id: "quiet" }),
      thread({ id: "unsnoozed", hasPendingInteraction: true }),
    ];

    expect(snoozesToEnd(threads, { asks: 1, quiet: 1 })).toEqual(["asks"]);
  });
});

describe("group early wake", () => {
  it("removes every stored member when any grouped descendant needs attention", () => {
    const rows = [
      thread({ id: "parent" }),
      thread({ id: "child", parentThreadId: "parent", hasPendingInteraction: true }),
      thread({ id: "sibling", parentThreadId: "parent" }),
      thread({ id: "other" }),
    ];
    const snoozes = { parent: 100, child: 100, sibling: 100, other: 100 };
    const groups = { parent: "family", child: "family", sibling: "family", other: "other" };
    expect(activeSnoozes(rows, snoozes, 0, groups)).toEqual(new Map([["other", 100]]));
    expect(snoozesToEnd(rows, snoozes, groups)).toEqual(["child"]);
  });

  it("issues one representative wake per group even when multiple members need the user", () => {
    const rows = [
      thread({ id: "parent", queuedWork: "failed" }),
      thread({ id: "child", indicator: "unread-error" }),
    ];
    expect(snoozesToEnd(rows, { parent: 100, child: 100 }, { parent: "g", child: "g" })).toEqual([
      "parent",
    ]);
  });

  it("does not wake a group for an outside child or an archived member", () => {
    const rows = [
      thread({ id: "parent" }),
      thread({ id: "archived", isArchived: true, hasPendingInteraction: true }),
      thread({ id: "new", parentThreadId: "parent", hasPendingInteraction: true }),
    ];
    expect(
      activeSnoozes(rows, { parent: 100, archived: 100 }, 0, { parent: "g", archived: "g" }),
    ).toEqual(new Map([["parent", 100]]));
  });
});
