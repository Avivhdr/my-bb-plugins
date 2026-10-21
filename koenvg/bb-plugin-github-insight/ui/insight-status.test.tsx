// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { InsightResult, rpcContract } from "../contract";
import type { PrInsight } from "../core/overview";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { forgetInsights } from "./pr-availability";

type ReadMethods = Pick<typeof rpcContract, "getInsight" | "refresh">;

const app = await loadPluginApp(() => import("../app"));
const banner = app.composerCustomizations.find((c) => c.id === "pr-insight")!.banners![0]!;
const tab = app.threadPanelActions.find((t) => t.id === "pr")!;
const base: PrInsight = {
  pr: {
    number: 1,
    title: "Thread A",
    state: "draft",
    url: "https://github.com/o/r/pull/1",
    headOid: "a",
    headRefName: "feature",
    headOwner: null,
    isCrossRepository: false,
    baseRefName: "main",
    author: "koenvg",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
  },
  mergeAction: { kind: "none" },
  blockers: [],
  checks: [],
  reviewers: [],
  mergeQueue: null,
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
};
const refreshedAt = Date.parse("2026-10-05T09:00:00Z");
const ok = (insight = base, error: string | null = null): InsightResult => ({
  kind: "ok",
  insight,
  refreshedAt,
  error,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(initial: InsightResult = ok()) {
  let current = initial;
  const read = vi.fn(async (_input: { threadId: string }): Promise<InsightResult> => current);
  const refresh = vi.fn(async (): Promise<InsightResult> => current);
  const options = {
    rpc: { getInsight: read, refresh, getTimeline: () => ({ kind: "no_pr" as const }) },
    composer: { scope: { kind: "thread" as const, threadId: "a" } },
  };
  const chat = renderSlot<object, ReadMethods>(banner, {}, options);
  const panel = renderSlot<PluginThreadPanelProps, ReadMethods>(
    tab,
    { threadId: "a", params: null },
    options,
  );
  const views = [within(chat.container), within(panel.container)];
  const reload = async () => {
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["a"] });
    await panel.behavior.emitRealtime("insight.updated", { threadIds: ["a"] });
  };
  return {
    chat,
    panel,
    views,
    read,
    refresh,
    reload,
    set: (result: InsightResult) => {
      current = result;
    },
  };
}
afterEach(() => {
  cleanup();
  forgetInsights();
});

describe("PR insight availability in both views", () => {
  it("shows when the shown data was read", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: refreshedAt + 3 * 3_600_000 });
    const panel = renderSlot(
      tab,
      { threadId: "a", params: null },
      { rpc: { getInsight: async () => ok() } },
    );

    await within(panel.container).findByText("Thread A");

    expect(panel.container.textContent).toContain("Updated 3 hours ago");
    vi.useRealTimers();
  });

  it("shows that it is updating while a background load runs", async () => {
    const first = renderSlot(
      tab,
      { threadId: "a", params: null },
      { rpc: { getInsight: async () => ok() } },
    );
    await within(first.container).findByText("Thread A");
    expect(within(first.container).queryByRole("status", { name: "Updating" })).toBeNull();
    cleanup();

    const again = renderSlot(
      tab,
      { threadId: "a", params: null },
      { rpc: { getInsight: () => new Promise<InsightResult>(() => {}) } },
    );

    expect(await within(again.container).findByRole("status", { name: "Updating" })).toBeTruthy();
  });

  it("shows the last PR at once when the user returns to a thread", async () => {
    const options = {
      rpc: { getInsight: async () => ok() },
      composer: { scope: { kind: "thread" as const, threadId: "a" } },
    };
    const first = renderSlot(tab, { threadId: "a", params: null }, options);
    await within(first.container).findByText("Thread A");
    cleanup();

    const again = renderSlot(
      tab,
      { threadId: "a", params: null },
      { ...options, rpc: { getInsight: () => new Promise<InsightResult>(() => {}) } },
    );

    expect(within(again.container).getByText("Thread A")).toBeTruthy();
    expect(within(again.container).queryByText("Loading pull request…")).toBeNull();
  });

  it("shows first-load progress and hides the banner only after confirmed no-PR", async () => {
    const pending = deferred<InsightResult>();
    const options = {
      rpc: { getInsight: () => pending.promise },
      composer: { scope: { kind: "thread" as const, threadId: "loading" } },
    };
    const chat = renderSlot(banner, {}, options);
    const panel = renderSlot(tab, { threadId: "loading", params: null }, options);
    for (const slot of [chat, panel])
      expect(within(slot.container).getByRole("status").textContent).toBe("Loading pull request…");
    await act(async () => pending.resolve({ kind: "no_pr" }));
    expect(chat.container.textContent).toBe("");
    expect(within(panel.container).getByText("No pull request for this thread")).toBeTruthy();
  });

  it("shows a first-read failure and recovers through Retry without opening the panel", async () => {
    const f = fixture({ kind: "error", message: "gh not logged in" });
    for (const view of f.views) {
      expect((await view.findByRole("alert")).textContent).toContain("gh not logged in");
      expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(view.queryByText("Draft")).toBeNull();
    }
    f.set(ok());
    for (const view of f.views) fireEvent.click(view.getByRole("button", { name: "Retry" }));
    for (const view of f.views) await view.findByText("Draft");
    expect(f.chat.inspection.navigateCalls).toEqual([]);
    expect(f.panel.inspection.navigateCalls).toEqual([]);
  });

  it.each(["draft", "open"] as const)(
    "retains a good %s after transport failures and clears the error after recovery",
    async (state) => {
      const data = ok({ ...base, pr: { ...base.pr, state } });
      const f = fixture(data);
      const label = state === "draft" ? "Draft" : "Open";
      for (const view of f.views) await view.findByText(label);
      f.read.mockRejectedValue(new Error("transport failed"));
      await f.reload();
      for (const view of f.views) {
        expect(view.getByText(label)).toBeTruthy();
        expect(view.getByRole("alert").textContent).toContain("transport failed");
      }
      for (const slot of [f.chat, f.panel])
        expect(slot.container.querySelector("time")?.getAttribute("datetime")).toBe(
          new Date(refreshedAt).toISOString(),
        );
      f.refresh.mockResolvedValue(data);
      for (const view of f.views) fireEvent.click(view.getByRole("button", { name: "Retry" }));
      await act(async () => {});
      for (const view of f.views) {
        expect(view.getByText(label)).toBeTruthy();
        expect(view.queryByRole("alert")).toBeNull();
      }
    },
  );

  it("keeps a server-cached draft with refresh error and last good time", async () => {
    const f = fixture(ok(base, "rate limited"));
    for (const view of f.views) {
      await view.findByText("Draft");
      expect(view.getByRole("alert").textContent).toContain("rate limited");
    }
    for (const slot of [f.chat, f.panel])
      expect(slot.container.querySelector("time")?.getAttribute("datetime")).toBe(
        new Date(refreshedAt).toISOString(),
      );
  });

  it("keeps status and details during refresh with progress in each view", async () => {
    const data = ok(
      { ...base, blockers: [{ code: "checks_failed", text: "1 check failed" }] },
      "previous failure",
    );
    const f = fixture(data);
    for (const view of f.views) await view.findByText("Draft");
    const pending = deferred<InsightResult>();
    f.refresh.mockImplementation(() => pending.promise);
    for (const view of f.views) fireEvent.click(view.getByRole("button", { name: "Retry" }));
    for (const view of f.views) {
      expect(view.getByText("Draft")).toBeTruthy();
      expect(view.getByText("1 check failed")).toBeTruthy();
      expect(view.getByRole("button", { name: "Retry" })).toHaveProperty("disabled", true);
    }
    expect(within(f.chat.container).getByText("Refreshing…")).toBeTruthy();
    expect(within(f.panel.container).getByRole("button", { name: "Refreshing…" })).toBeTruthy();
    await act(async () => pending.resolve(ok(base)));
  });

  it("forgets retained data after a confirmed no-PR result", async () => {
    const f = fixture();
    for (const view of f.views) await view.findByText("Draft");
    f.set({ kind: "no_pr" });
    await f.reload();
    expect(f.chat.container.textContent).toBe("");
    f.read.mockRejectedValue(new Error("new failure"));
    await f.reload();
    for (const view of f.views) {
      await view.findByText("new failure");
      expect(view.queryByText("Draft")).toBeNull();
    }
  });

  it("converges across lifecycle and queue transitions without new polling or fetch paths", async () => {
    const f = fixture();
    for (const view of f.views) await view.findByText("Draft");
    const updates: [PrInsight, string][] = [
      [{ ...base, pr: { ...base.pr, state: "open" } }, "Open"],
      [
        {
          ...base,
          pr: { ...base.pr, state: "open" },
          mergeQueue: { position: 2, state: "queued" },
        },
        "In merge queue (#2)",
      ],
      [
        {
          ...base,
          pr: { ...base.pr, state: "open" },
          mergeQueue: { position: 2, state: "awaiting_checks" },
        },
        "Merge queue checks running (#2)",
      ],
      [
        {
          ...base,
          pr: { ...base.pr, state: "open" },
          mergeQueue: { position: 2, state: "merging" },
        },
        "Merging",
      ],
      [
        {
          ...base,
          pr: { ...base.pr, state: "open" },
          mergeQueue: { position: 2, state: "failed" },
        },
        "Merge queue failed",
      ],
      [{ ...base, pr: { ...base.pr, state: "closed" } }, "Closed"],
      [{ ...base, pr: { ...base.pr, state: "merged" } }, "Pull request merged"],
    ];
    for (const [insight, text] of updates) {
      f.set(ok(insight));
      await f.reload();
      for (const view of f.views) {
        expect(view.getByText(text)).toBeTruthy();
        expect(view.queryByText("Draft")).toBeNull();
      }
    }
    expect(f.read).toHaveBeenCalledTimes(2 + updates.length * 2);
    expect(f.refresh).not.toHaveBeenCalled();
  });

  it("does not show retained A data or its late read after navigating to B", async () => {
    const f = fixture();
    await within(f.chat.container).findByText("Draft");
    const pending = deferred<InsightResult>();
    f.read.mockImplementation(({ threadId }) =>
      threadId === "a" ? pending.promise : Promise.reject(new Error("B read failed")),
    );
    await f.chat.behavior.emitRealtime("insight.updated", { threadIds: ["a"] });
    await f.chat.behavior.setComposerScope({ kind: "thread", threadId: "b" });
    const view = within(f.chat.container);
    await view.findByText("B read failed");
    await act(async () => pending.resolve(ok()));
    expect(view.queryByText("Draft")).toBeNull();
    expect(view.getByText("B read failed")).toBeTruthy();
    expect(f.chat.container.querySelector("time")).toBeNull();
  });
});
