import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { thread } from "./fixtures";
import { describeIndicator, isActive, relativeTime, rowState, workItems } from "./row-cues";

describe("thread indicator", () => {
  it("keeps the host's attention label and distinguishes runtime/queued state", () => {
    expect(
      describeIndicator(
        thread({ indicator: "waiting-for-input", indicatorLabel: "Thread needs user input" }),
      ),
    ).toBe("Thread needs user input");
    expect(describeIndicator(thread({ indicator: "runtime", runtimeStatus: "active" }))).toBe(
      "Thread active",
    );
    expect(describeIndicator(thread({ indicator: "queued-waiting", queuedWork: "waiting" }))).toBe(
      "Queued message waiting",
    );
  });
  it("uses a safe fallback for new host indicator kinds", () => {
    expect(
      describeIndicator(thread({ indicator: "future-kind" as PluginSidebarThread["indicator"] })),
    ).toBe("Thread status: idle");
  });
  it("formats elapsed time in the largest whole unit", () => {
    const now = 10 * 365 * 86_400_000;
    expect(relativeTime(now - 20_000, now)).toBe("now");
    expect(relativeTime(now + 5_000, now)).toBe("now");
    expect(relativeTime(now - 25 * 60_000, now)).toBe("25m");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h");
    expect(relativeTime(now - 6 * 86_400_000, now)).toBe("6d");
    expect(relativeTime(now - 20 * 86_400_000, now)).toBe("2w");
    expect(relativeTime(now - 800 * 86_400_000, now)).toBe("2y");
  });
  it("states what the thread is doing, with a raised hand above live work", () => {
    expect(rowState(thread({ status: "active", hasPendingInteraction: true }), false)).toEqual({
      label: "Needs you",
      title: "Thread needs user input",
      tone: "danger",
    });
    expect(rowState(thread({ indicator: "unread-error" }), false)).toMatchObject({
      label: "Failed",
      tone: "danger",
    });
    expect(rowState(thread({ queuedWork: "failed" }), false)).toMatchObject({
      label: "Not sent",
      tone: "danger",
    });
    expect(rowState(thread({ status: "active", runtimeStatus: "active" }), false)).toEqual({
      label: "Working",
      title: "Thread active",
      tone: "live",
    });
    expect(rowState(thread({ indicator: "plan-mode" }), false)).toEqual({
      label: "Planning",
      title: "Plan mode",
      tone: "live",
    });
    expect(
      rowState(
        thread({
          activity: {
            workflows: 1,
            backgroundAgents: 0,
            backgroundCommands: 0,
            planMode: 0,
            goals: 0,
          },
        }),
        false,
      ),
    ).toMatchObject({ label: "Background", tone: "live" });
    expect(rowState(thread({ indicator: "draft" }), false)).toMatchObject({
      label: "Draft",
      tone: "muted",
    });
    expect(rowState(thread(), true)).toEqual({
      label: "Draft",
      title: "Unsent draft",
      tone: "muted",
    });
    expect(rowState(thread({ isUnread: true, indicator: "unread-success" }), false)).toBeNull();
    expect(rowState(thread(), false)).toBeNull();
  });
  it("lists queued and background work as icon items", () => {
    expect(
      workItems(
        thread({
          queuedWork: "failed",
          activity: {
            workflows: 2,
            backgroundAgents: 1,
            backgroundCommands: 3,
            planMode: 1,
            goals: 1,
          },
        }),
      ),
    ).toEqual([
      {
        key: "queued",
        icon: "AlertCircle",
        text: "Not sent",
        title: "Queued message failed",
        error: true,
      },
      { key: "workflows", icon: "Workflow", text: "2", title: "2 workflows", error: false },
      { key: "agents", icon: "Bot", text: "1", title: "1 background agent", error: false },
      {
        key: "commands",
        icon: "Terminal",
        text: "3",
        title: "3 background commands",
        error: false,
      },
      { key: "plan", icon: "ListTodo", text: "Plan", title: "Plan mode", error: false },
      { key: "goals", icon: "Target", text: "1", title: "1 goal", error: false },
    ]);
    expect(workItems(thread({ queuedWork: "waiting" }))).toEqual([
      {
        key: "queued",
        icon: "Clock",
        text: "Queued",
        title: "Queued message waiting",
        error: false,
      },
    ]);
    expect(workItems(thread())).toEqual([]);
  });
});

const activity = {
  workflows: 0,
  backgroundAgents: 1,
  backgroundCommands: 0,
  planMode: 0,
  goals: 0,
};

describe("isActive", () => {
  it.each<[string, Partial<PluginSidebarThread>, boolean]>([
    ["runs", { status: "active" }, true],
    ["has background work", { activity }, true],
    ["has a queued message", { queuedWork: "waiting" }, true],
    ["waits for an approval", { hasPendingInteraction: true }, true],
    ["has an unread error", { indicator: "unread-error", isUnread: true }, true],
    ["only has unread output", { isUnread: true, indicator: "unread-success" }, false],
    ["is idle", {}, false],
  ])("a thread that %s is active: %s", (_name, overrides, active) => {
    expect(isActive(thread(overrides))).toBe(active);
  });
});
