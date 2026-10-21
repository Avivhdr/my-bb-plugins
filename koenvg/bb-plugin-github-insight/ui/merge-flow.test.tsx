// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ActionResult, InsightResult } from "../contract";
import type { PrInsight } from "../core/overview";
import { GITHUB_COMMANDS } from "./commands";
import { forgetInsights, rememberInsight } from "./pr-availability";
import { forgetSubTabs } from "./pr-sub-tab";

const app = await loadPluginApp(() => import("../app"));
const banner = app.composerCustomizations.find((c) => c.id === "pr-insight")!.banners![0]!;
const tab = app.threadPanelActions.find((t) => t.id === "pr")!;
const pr = {
  number: 7,
  title: "Shared progress",
  state: "open" as const,
  url: "https://github.com/o/r/pull/7",
  headOid: "a",
  headRefName: "feature",
  headOwner: null,
  isCrossRepository: false,
  baseRefName: "main",
  author: "koenvg",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
};
const ready: PrInsight = {
  pr,
  mergeAction: { kind: "merge", method: "SQUASH" },
  blockers: [],
  checks: [],
  reviewers: [],
  mergeQueue: null,
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
};
const ok = (insight: PrInsight = ready, error: string | null = null): InsightResult => ({
  kind: "ok",
  insight,
  refreshedAt: 1,
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
  const getInsight = vi.fn(async (): Promise<InsightResult> => current);
  const refresh = vi.fn(async (): Promise<InsightResult> => current);
  const write = vi.fn(async (): Promise<ActionResult> => ({ kind: "ok" }));
  const options = {
    rpc: {
      getInsight,
      refresh,
      runPrAction: write,
      getTimeline: () => ({ kind: "no_pr" as const }),
    },
    composer: { scope: { kind: "thread" as const, threadId: "flow" } },
  };
  const mountBanner = () => {
    const slot = renderSlot(banner, {}, options);
    mounted.push(slot);
    return slot;
  };
  const mountTab = () => {
    const slot = renderSlot(tab, { threadId: "flow", params: null }, options);
    mounted.push(slot);
    return slot;
  };
  return {
    mountBanner,
    mountTab,
    getInsight,
    refresh,
    write,
    set: (value: InsightResult) => {
      current = value;
    },
  };
}
const mounted: ReturnType<typeof renderSlot>[] = [];
const command = GITHUB_COMMANDS.find((c) => c.id === "merge-pr")!;
const openPanel = vi.fn(() => true);
async function merge(threadId = "flow") {
  await act(async () => {
    await command.run({ threadId, projectId: null, openPanel });
  });
}
async function confirm() {
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Squash and merge" }));
}
afterEach(() => {
  for (const slot of mounted) expect(slot.inspection.navigateCalls).toEqual([]);
  mounted.length = 0;
  cleanup();
  forgetInsights();
  forgetSubTabs();
  openPanel.mockClear();
});

describe("palette command delivered during banner mount", () => {
  it.each(["merge", "enqueue"] as const)(
    "waits for the mount load instead of using cached %s data",
    async (action) => {
      const cached = ok({
        ...ready,
        mergeAction: action === "merge" ? ready.mergeAction : { kind: "enqueue" },
      });
      rememberInsight("flow", cached);
      const f = fixture(cached);
      const load = deferred<InsightResult>();
      f.getInsight.mockImplementationOnce(() => load.promise);
      await merge();
      f.mountBanner();

      expect(f.getInsight).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(f.write).not.toHaveBeenCalled();
      expect(f.refresh).not.toHaveBeenCalled();

      const fresh = ok({
        ...ready,
        pr: { ...pr, headOid: "b" },
        mergeAction: action === "merge" ? { kind: "merge", method: "REBASE" } : { kind: "enqueue" },
      });
      f.set(fresh);
      await act(async () => load.resolve(fresh));
      if (action === "merge") {
        const dialog = screen.getByRole("alertdialog");
        expect(within(dialog).getByText("Method: Rebase and merge")).toBeTruthy();
        expect(f.write).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Rebase and merge" }));
      } else expect(screen.queryByRole("alertdialog")).toBeNull();
      await act(async () => {});
      expect(f.write).toHaveBeenCalledExactlyOnceWith({
        threadId: "flow",
        action,
        expectedHeadOid: "b",
      });
    },
  );
});

describe("shared tab and banner merge progress", () => {
  it.each(["merge", "enqueue"] as const)(
    "shares %s loading, errors, and duplicate protection",
    async (action) => {
      const f = fixture(
        ok({ ...ready, mergeAction: action === "merge" ? ready.mergeAction : { kind: "enqueue" } }),
      );
      const pending = deferred<ActionResult>();
      f.write.mockImplementation(() => pending.promise);
      const chat = f.mountBanner();
      const panel = f.mountTab();
      await screen.findByText("#7");
      const label = action === "merge" ? "Squash and merge" : "Enqueue";
      fireEvent.click(within(panel.container).getByRole("button", { name: label }));
      if (action === "merge") await confirm();
      const busy = action === "merge" ? "Merging…" : "Enqueuing…";
      expect(within(chat.container).getByRole("button", { name: busy })).toHaveProperty(
        "disabled",
        true,
      );
      expect(within(panel.container).getByRole("button", { name: busy })).toHaveProperty(
        "disabled",
        true,
      );
      expect(within(chat.container).queryByText(/Ready to/)).toBeNull();
      await merge();
      expect(f.write).toHaveBeenCalledTimes(1);
      await act(async () => pending.resolve({ kind: "error", message: "denied" }));
      expect(within(chat.container).getByRole("alert").textContent).toContain("denied");
      expect(within(panel.container).getByRole("alert").textContent).toContain("denied");
      expect(within(chat.container).getByRole("button", { name: label })).toHaveProperty(
        "disabled",
        false,
      );
      expect(openPanel).not.toHaveBeenCalled();
    },
  );

  it("opens confirmation from loaded data without a refresh", async () => {
    const f = fixture();
    f.mountBanner();
    await screen.findByText("Ready to merge");
    f.refresh.mockImplementation(() => deferred<InsightResult>().promise);

    await merge();
    await merge();

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Method: Squash and merge")).toBeTruthy();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.queryByText("Loading pull request…")).toBeNull();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.write).not.toHaveBeenCalled();
    await confirm();
    expect(f.write).toHaveBeenCalledExactlyOnceWith({
      threadId: "flow",
      action: "merge",
      expectedHeadOid: "a",
    });
  });

  it("shows an active write in a tab mounted later and refreshes both views", async () => {
    const f = fixture();
    const pending = deferred<ActionResult>();
    f.write.mockImplementation(() => pending.promise);
    const chat = f.mountBanner();
    fireEvent.click(await screen.findByRole("button", { name: "Squash and merge" }));
    await confirm();
    const panel = f.mountTab();
    expect(await within(panel.container).findByRole("button", { name: "Merging…" })).toHaveProperty(
      "disabled",
      true,
    );
    f.set(ok({ ...ready, pr: { ...pr, state: "merged" }, mergeAction: { kind: "none" } }));
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await panel.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await act(async () => pending.resolve({ kind: "ok" }));
    expect(within(chat.container).getByText("Pull request merged")).toBeTruthy();
    expect(within(panel.container).getByText("Pull request merged")).toBeTruthy();
  });
});

describe("palette merge without side-panel navigation", () => {
  it.each([
    [
      "enqueue",
      ok({ ...ready, pr: { ...pr, headOid: "b" }, mergeAction: { kind: "enqueue" } }),
      null,
    ],
    [
      "blocked",
      ok({
        ...ready,
        mergeAction: { kind: "none" },
        blockers: [{ code: "checks_failed", text: "1 check failed" }],
      }),
      "1 check failed",
    ],
    ["missing", { kind: "no_pr" } as InsightResult, "No pull request for this thread"],
  ])("uses %s data from the latest completed load", async (_, fresh, message) => {
    const f = fixture();
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    f.set(fresh);
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await merge();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    if (message) {
      expect(screen.getByRole("alert").textContent).toContain(message);
      expect(f.write).not.toHaveBeenCalled();
    } else {
      expect(f.write).toHaveBeenCalledWith({
        threadId: "flow",
        action: "enqueue",
        expectedHeadOid: "b",
      });
      expect(f.write).toHaveBeenCalledTimes(1);
    }
  });

  it("uses the method and head from the latest completed load", async () => {
    const f = fixture();
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    const fresh = ok({
      ...ready,
      pr: { ...pr, headOid: "b" },
      mergeAction: { kind: "merge", method: "REBASE" },
    });
    f.set(fresh);
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await merge();
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Method: Rebase and merge")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rebase and merge" }));
    await act(async () => {});
    expect(f.write).toHaveBeenCalledWith({
      threadId: "flow",
      action: "merge",
      expectedHeadOid: "b",
    });
  });

  it("clears a recovered load error without a PR or head change", async () => {
    const f = fixture();
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    f.set(ok(ready, "rate limited"));
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await merge();
    expect(
      screen
        .getAllByRole("alert")
        .map((alert) => alert.textContent)
        .join(" "),
    ).toContain("rate limited");
    f.set(ok());
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each([
    ["state", "failed", 3, "merging", 3, "Merge queue failed", "Merging"],
    ["position", "queued", 3, "queued", 4, "In merge queue (#3)", "In merge queue (#4)"],
  ] as const)(
    "clears old palette feedback when queue %s changes without a new head",
    async (_, fromState, fromPosition, toState, toPosition, oldText, newText) => {
      const queued = {
        ...ready,
        mergeAction: { kind: "queued" as const },
        mergeQueue: { position: fromPosition, state: fromState },
      };
      const f = fixture(ok(queued));
      const chat = f.mountBanner();
      const panel = f.mountTab();
      await within(chat.container).findByText(oldText);
      await merge();
      expect(within(chat.container).getByRole("alert").textContent).toContain(oldText);

      f.set(ok({ ...queued, mergeQueue: { position: toPosition, state: toState } }));
      await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
      await panel.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });

      for (const slot of [chat, panel])
        expect(within(slot.container).getByText(newText)).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(f.refresh).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled();
    },
  );

  it.each(["closed", "other"])(
    "keeps a %s side panel unchanged through merge progress",
    async (selected) => {
      const f = fixture();
      const pending = deferred<ActionResult>();
      f.write.mockImplementation(() => pending.promise);
      f.mountBanner();
      await screen.findByText("Ready to merge");
      let panel = selected;
      const open = vi.fn(() => {
        panel = "pr";
        return true;
      });
      await act(async () => {
        await command.run({ threadId: "flow", projectId: null, openPanel: open });
      });
      await confirm();
      expect(panel).toBe(selected);
      await act(async () => pending.resolve({ kind: "error", message: "denied" }));
      expect(screen.getByRole("alert").textContent).toContain("denied");
      expect(open).not.toHaveBeenCalled();
      expect(panel).toBe(selected);
    },
  );

  it("keeps the Files sub-tab of the PR tab through merge progress", async () => {
    const f = fixture();
    const pending = deferred<ActionResult>();
    f.write.mockImplementation(() => pending.promise);
    f.mountBanner();
    const panel = f.mountTab();
    await screen.findByText("Ready to merge");
    fireEvent.click(within(panel.container).getByRole("tab", { name: "Files" }));
    const selectedTab = () =>
      within(panel.container).getByRole("tab", { selected: true }).querySelector("[data-tab-label]")
        ?.textContent;

    await merge();
    await confirm();
    expect(selectedTab()).toBe("Files");
    await act(async () => pending.resolve({ kind: "ok" }));

    expect(selectedTab()).toBe("Files");
    expect(openPanel).not.toHaveBeenCalled();
  });

  it("supports keyboard cancellation and a keyboard-generated confirmation click", async () => {
    const f = fixture();
    f.mountBanner();
    await screen.findByText("Ready to merge");
    await merge();
    const dialog = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(f.write).not.toHaveBeenCalled();
    await merge();
    const button = within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "Squash and merge",
    });
    button.focus();
    fireEvent.click(button, { detail: 0 });
    await act(async () => {});
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it("clears a shared error when a new head loads", async () => {
    const f = fixture();
    f.write.mockResolvedValue({ kind: "error", message: "old head rejected" });
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    await merge();
    await confirm();
    await screen.findByRole("alert");
    f.set(ok({ ...ready, pr: { ...pr, headOid: "b" } }));
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses loaded data, confirms once, cancels, and preserves the selected panel", async () => {
    const f = fixture();
    f.mountBanner();
    f.mountTab();
    await screen.findByText("#7");
    await merge();
    await merge();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByText("Merge pull request #7?")).toBeTruthy();
    expect(f.write).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(openPanel).not.toHaveBeenCalled();
  });

  it("waits for an active load and uses the new method and head", async () => {
    const f = fixture();
    const load = deferred<InsightResult>();
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    f.getInsight.mockImplementation(() => load.promise);
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await merge();
    await merge();
    expect(screen.getByText("Loading pull request…")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await act(async () =>
      load.resolve(
        ok({
          ...ready,
          pr: { ...pr, headOid: "b" },
          mergeAction: { kind: "merge", method: "REBASE" },
        }),
      ),
    );
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText("Method: Rebase and merge")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Rebase and merge" }));
    await act(async () => {});
    expect(f.write).toHaveBeenCalledWith({
      threadId: "flow",
      action: "merge",
      expectedHeadOid: "b",
    });
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.getInsight).toHaveBeenCalledTimes(2);
    expect(openPanel).not.toHaveBeenCalled();
  });

  it("waits for missing PR data without starting another load", async () => {
    const f = fixture();
    const load = deferred<InsightResult>();
    f.getInsight.mockImplementationOnce(() => load.promise);
    f.mountBanner();
    await merge();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(f.refresh).not.toHaveBeenCalled();
    expect(f.getInsight).toHaveBeenCalledTimes(1);
    await act(async () => load.resolve(ok()));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(f.write).not.toHaveBeenCalled();
  });

  it("waits for an explicit refresh without starting another refresh", async () => {
    const f = fixture(ok(ready, "offline"));
    const load = deferred<InsightResult>();
    f.mountBanner();
    await screen.findByRole("button", { name: "Retry" });
    f.refresh.mockImplementationOnce(() => load.promise);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await merge();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    await act(async () => load.resolve(ok()));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(f.write).not.toHaveBeenCalled();
  });

  it.each([
    [
      "blocked",
      ok({
        ...ready,
        mergeAction: { kind: "none" },
        blockers: [{ code: "checks_failed", text: "1 check failed" }],
      }),
      "1 check failed",
    ],
    ["failed", { kind: "error", message: "offline" } as InsightResult, "offline"],
    ["missing", { kind: "no_pr" } as InsightResult, "No pull request for this thread"],
  ] as const)(
    "does not use an earlier action when an active load is %s",
    async (_, result, message) => {
      const f = fixture();
      const chat = f.mountBanner();
      await screen.findByText("Ready to merge");
      const load = deferred<InsightResult>();
      f.getInsight.mockImplementationOnce(() => load.promise);
      await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
      await merge();
      expect(screen.queryByRole("alertdialog")).toBeNull();
      await act(async () => load.resolve(result));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(
        screen
          .getAllByRole("alert")
          .map((a) => a.textContent)
          .join(" "),
      ).toContain(message);
      expect(f.refresh).not.toHaveBeenCalled();
      expect(f.write).not.toHaveBeenCalled();
    },
  );

  it("dismissing an operation error does not dismiss a later read failure", async () => {
    const f = fixture();
    f.write.mockResolvedValue({ kind: "error", message: "merge denied" });
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    await merge();
    await confirm();
    await screen.findByText("merge denied");
    f.set(ok(ready, "read rate limited"));
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss merge message" }));
    expect(screen.getByRole("alert").textContent).toContain("read rate limited");
    expect(screen.queryByText("merge denied")).toBeNull();
  });

  it.each([
    ["missing", { kind: "no_pr" } as InsightResult, "No pull request for this thread"],
    [
      "draft with stale action",
      ok({ ...ready, pr: { ...pr, state: "draft" } }),
      "This pull request cannot merge.",
    ],
    [
      "queue failure with stale action",
      ok({ ...ready, mergeQueue: { position: 3, state: "failed" } }),
      "Merge queue failed",
    ],
    ["closed", ok({ ...ready, pr: { ...pr, state: "closed" } }), "Pull request closed"],
    ["merged", ok({ ...ready, pr: { ...pr, state: "merged" } }), "Pull request merged"],
    ["queued", ok({ ...ready, mergeAction: { kind: "queued" } }), "In merge queue"],
    [
      "blocked",
      ok({
        ...ready,
        mergeAction: { kind: "none" },
        blockers: [{ code: "checks_failed", text: "1 check failed" }],
      }),
      "1 check failed",
    ],
    ["failed load", { kind: "error", message: "offline" } as InsightResult, "offline"],
    ["retained data", ok(ready, "rate limited"), "rate limited"],
  ])(
    "shows %s feedback without hiding read failures when command feedback is dismissed",
    async (_, result, text) => {
      const f = fixture();
      const chat = f.mountBanner();
      await screen.findByText("Ready to merge");
      f.set(result);
      await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
      await merge();
      expect(
        within(chat.container)
          .getAllByRole("alert")
          .map((alert) => alert.textContent)
          .join(" "),
      ).toContain(text);
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(f.write).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Dismiss merge message" }));
      const hasReadError =
        result.kind === "error" || (result.kind === "ok" && result.error !== null);
      if (hasReadError) {
        expect(screen.getByRole("alert").textContent).toContain(text);
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      } else expect(screen.queryByRole("alert")).toBeNull();
      expect(openPanel).not.toHaveBeenCalled();
    },
  );

  it("enqueues immediately once and shows failure without panel navigation", async () => {
    const f = fixture(ok({ ...ready, mergeAction: { kind: "enqueue" } }));
    const pending = deferred<ActionResult>();
    f.write.mockImplementation(() => pending.promise);
    f.mountBanner();
    await screen.findByText("Ready to enqueue");
    await merge();
    await merge();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Enqueuing…" })).toHaveProperty("disabled", true);
    expect(f.write).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ kind: "error", message: "denied" }));
    expect(screen.getByRole("alert").textContent).toContain("denied");
    expect(openPanel).not.toHaveBeenCalled();
  });

  it("discards preparation on thread switch and never replays it", async () => {
    const f = fixture();
    const pending = deferred<InsightResult>();
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    f.getInsight.mockImplementationOnce(() => pending.promise);
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    await merge();
    await chat.behavior.setComposerScope({ kind: "thread", threadId: "other" });
    await act(async () => pending.resolve(ok()));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(f.write).not.toHaveBeenCalled();
    await chat.behavior.setComposerScope({ kind: "thread", threadId: "flow" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closes unconfirmed dialogs on remount and keeps a sent write on its source thread", async () => {
    const f = fixture();
    const pending = deferred<ActionResult>();
    f.write.mockImplementation(() => pending.promise);
    const first = f.mountBanner();
    await screen.findByText("Ready to merge");
    await merge();
    first.unmount();
    const second = f.mountBanner();
    await screen.findByText("Ready to merge");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await merge();
    await confirm();
    await second.behavior.setComposerScope({ kind: "thread", threadId: "other" });
    expect(screen.queryByText("Merging…")).toBeNull();
    await second.behavior.setComposerScope({ kind: "thread", threadId: "flow" });
    expect(await screen.findByRole("button", { name: "Merging…" })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => pending.resolve({ kind: "ok" }));
    expect(f.write).toHaveBeenCalledTimes(1);
  });

  it("drops obsolete feedback and never retargets an open confirmation", async () => {
    const f = fixture();
    const chat = f.mountBanner();
    await screen.findByText("Ready to merge");
    await merge();
    f.set(ok({ ...ready, pr: { ...pr, headOid: "b" } }));
    await chat.behavior.emitRealtime("insight.updated", { threadIds: ["flow"] });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("PR changed");
    await merge();
    await confirm();
    await act(async () => {});
    expect(f.write).toHaveBeenCalledWith({
      threadId: "flow",
      action: "merge",
      expectedHeadOid: "b",
    });
  });
});
