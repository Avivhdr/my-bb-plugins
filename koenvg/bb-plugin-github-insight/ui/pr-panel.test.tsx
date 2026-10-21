// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { InsightResult, ReviewResult, rpcContract, TimelineResult } from "../contract";
import type { ReviewThread } from "../core/review-threads";
import type { TimelineEvent } from "../core/timeline";
import { postIntent } from "./command-intents";
import { GITHUB_COMMANDS } from "./commands";
import { forgetInsights } from "./pr-availability";
import { forgetSubTabs } from "./pr-sub-tab";

class Unobserved {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", Unobserved);
  vi.stubGlobal("IntersectionObserver", Unobserved);
});

const app = await loadPluginApp(() => import("../app"));
const prTab = app.threadPanelActions.find((action) => action.id === "pr")!;

afterEach(() => {
  cleanup();
  forgetInsights();
  forgetSubTabs();
});

const emptyReview: ReviewResult = {
  kind: "ok",
  files: [],
  threads: { placed: [], outdated: [] },
  drafts: {},
  head: {
    prNodeId: "PR_1",
    oid: "def456",
    state: "OPEN",
    viewerIsAuthor: false,
    viewerReview: null,
  },
  commentDrafts: [],
  summaryDraft: null,
  viewedMarks: {},
  newCommentIds: [],
};

interface Handlers {
  getInsight?: () => InsightResult | Promise<InsightResult>;
  getReview?: () => ReviewResult | Promise<ReviewResult>;
  getTimeline?: () => TimelineResult | Promise<TimelineResult>;
}

function renderPanel(threadId = "thr_1", handlers: Handlers = {}) {
  const fail = () => ({ kind: "error" as const, message: "unused" });
  return renderSlot<PluginThreadPanelProps, typeof rpcContract>(
    prTab,
    { threadId, params: null },
    {
      rpc: {
        getPrVideo: () => ({ kind: "error", code: "read", message: "unavailable" }),
        getPrImage: () => ({ kind: "error", code: "read", message: "unavailable" }),
        getInsight: handlers.getInsight ?? (() => ({ kind: "no_pr" })),
        refresh: () => ({ kind: "no_pr" }),
        getReview: handlers.getReview ?? (() => emptyReview),
        getDrafts: () => ({ kind: "no_pr" }),
        getTimeline: handlers.getTimeline ?? (() => ({ kind: "no_pr" })),
        addPrComment: fail,
        markCommentsSeen: fail,
        sendToAgent: fail,
        reply: () => ({ kind: "post_failed", message: "unused" }),
        setResolved: fail,
        saveDraft: fail,
        discardDraft: fail,
        createCommentDraft: fail,
        saveCommentDraft: fail,
        deleteCommentDraft: fail,
        saveSummaryDraft: fail,
        updateViewed: fail,
        submitReview: () => ({ kind: "error", message: "unused", url: null }),
        getReviewQueue: () => ({ kind: "error", message: "unused", lastGood: null }),
        refreshReviewQueue: () => ({ kind: "error", message: "unused", lastGood: null }),
        startReview: () => ({ threadId: "unused" }),
        getPrimaryHost: () => ({ hostId: null }),
        archiveReview: fail,
        markReviewed: fail,
        markNeedsReview: fail,
        markQueueSeen: fail,
        markThreadOpened: fail,
        runPrAction: fail,
        localCommitsAhead: () => ({ kind: "unknown" }),
        getPrInsight: () => ({ kind: "no_pr" }),
        refreshPrInsight: () => ({ kind: "no_pr" }),
      },
    },
  );
}

type Slot = ReturnType<typeof renderPanel>;

function subTab(slot: Slot, name: "Overview" | "Files") {
  return slot.getByRole("tab", { name });
}

function selected(slot: Slot) {
  return slot.getByRole("tab", { selected: true }).querySelector("[data-tab-label]")?.textContent;
}

function reviewCalls(slot: Slot) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "getReview");
}

describe("PR panel", () => {
  it("registers one flush PR action and no Review action", () => {
    expect(app.threadPanelActions.map(({ id }) => id)).toEqual(["pr"]);
    expect(prTab).toMatchObject({ title: "PR", layout: "flush" });
  });

  it("starts a new PR tab on Overview", async () => {
    const slot = renderPanel();

    await slot.findAllByText("No pull request for this thread");

    expect(selected(slot)).toBe("Overview");
    expect(slot.getByRole("tabpanel").id).toBe(
      subTab(slot, "Overview").getAttribute("aria-controls"),
    );
  });

  it("switches to Files on a click", async () => {
    const slot = renderPanel();

    fireEvent.click(subTab(slot, "Files"));

    expect(selected(slot)).toBe("Files");
    expect(await slot.findByText("0 files changed")).toBeTruthy();
  });

  it("switches with the arrow keys", () => {
    const slot = renderPanel();

    fireEvent.keyDown(subTab(slot, "Overview"), { key: "ArrowRight" });

    expect(selected(slot)).toBe("Files");
    expect(document.activeElement).toBe(subTab(slot, "Files"));
  });

  it("does not read the PR files before Files shows", async () => {
    const slot = renderPanel();

    await slot.findAllByText("No pull request for this thread");

    expect(reviewCalls(slot)).toEqual([]);
  });

  it("keeps Files mounted and hidden while Overview shows", async () => {
    const slot = renderPanel();
    fireEvent.click(subTab(slot, "Files"));
    const files = await slot.findByText("0 files changed");

    fireEvent.click(subTab(slot, "Overview"));

    expect(files.isConnected).toBe(true);
    expect(files.closest("[role=tabpanel]")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(subTab(slot, "Files"));
    expect(slot.getByText("0 files changed")).toBe(files);
    expect(reviewCalls(slot)).toHaveLength(1);
  });

  it("keeps the selected sub-tab after an unmount", async () => {
    const first = renderPanel();
    fireEvent.click(subTab(first, "Files"));
    first.lifecycle.unmount();

    const second = renderPanel();

    expect(selected(second)).toBe("Files");
  });

  it("keeps the sub-tab of each thread", () => {
    const first = renderPanel("thr_a");
    fireEvent.click(subTab(first, "Files"));
    first.lifecycle.unmount();

    expect(selected(renderPanel("thr_b"))).toBe("Overview");
  });

  it("selects the sub-tab that an intent names", async () => {
    const slot = renderPanel();

    act(() => postIntent("thr_1", "pr", "show-files"));
    expect(selected(slot)).toBe("Files");

    act(() => postIntent("thr_1", "pr", "show-overview"));
    expect(selected(slot)).toBe("Overview");
  });

  it("does not read the PR files when an Overview open meets a tab remembered on Files", async () => {
    const first = renderPanel("thr_remembered");
    fireEvent.click(subTab(first, "Files"));
    first.lifecycle.unmount();
    postIntent("thr_remembered", "pr", "show-overview");

    const second = renderPanel("thr_remembered");

    expect(selected(second)).toBe("Overview");
    await second.findAllByText("No pull request for this thread");
    expect(reviewCalls(second)).toEqual([]);
  });

  it("selects the sub-tab of an intent posted before it mounts", () => {
    postIntent("thr_1", "pr", "show-files");

    expect(selected(renderPanel())).toBe("Files");
  });

  it.each(["Overview", "Files"] as const)("shows the no PR state on %s", async (name) => {
    const slot = renderPanel("thr_1", { getReview: () => ({ kind: "no_pr" }) });

    fireEvent.click(subTab(slot, name));

    const panel = slot.getByRole("tabpanel");
    expect(await within(panel).findByText("No pull request for this thread")).toBeTruthy();
  });

  it.each(["Overview", "Files"] as const)("shows loading on %s", (name) => {
    const never = () => new Promise<never>(() => {});
    const slot = renderPanel("thr_1", { getInsight: never, getReview: never });

    fireEvent.click(subTab(slot, name));

    expect(within(slot.getByRole("tabpanel")).getByText("Loading pull request…")).toBeTruthy();
  });

  it.each(["Overview", "Files"] as const)("shows the read error on %s", async (name) => {
    const slot = renderPanel("thr_1", {
      getInsight: () => ({ kind: "error", message: "gh not logged in" }),
      getReview: () => ({ kind: "error", message: "gh not logged in" }),
    });

    fireEvent.click(subTab(slot, name));

    const panel = slot.getByRole("tabpanel");
    expect(await within(panel).findByText("gh not logged in")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: /Retry/ })).toBeTruthy();
  });
});

function runCommand(id: string, threadId = "thr_1") {
  const found = GITHUB_COMMANDS.find((entry) => entry.id === id)!;
  void found.run({ threadId, projectId: null, openPanel: () => true });
}

describe("PR panel palette commands", () => {
  it("Submit review opens a closed PR tab on Files with the Submit panel", async () => {
    runCommand("submit-review");
    const slot = renderPanel();

    expect(selected(slot)).toBe("Files");
    expect(await slot.findByRole("region", { name: "Submit review" })).toBeTruthy();
  });

  it("Submit review switches an open PR tab from Overview to Files", async () => {
    const slot = renderPanel();
    await slot.findAllByText("No pull request for this thread");

    act(() => runCommand("submit-review"));

    expect(selected(slot)).toBe("Files");
    expect(await slot.findByRole("region", { name: "Submit review" })).toBeTruthy();
  });

  it("does not open the Submit panel again after a remount", async () => {
    runCommand("submit-review");
    const first = renderPanel();
    await first.findByRole("region", { name: "Submit review" });
    fireEvent.click(first.getByRole("button", { name: "Submit review" }));
    first.lifecycle.unmount();

    const second = renderPanel();

    await second.findByText("0 files changed");
    expect(second.queryByRole("region", { name: "Submit review" })).toBeNull();
  });

  it.each(["next-comment", "previous-comment", "open-pr-files"])(
    "%s switches an open PR tab to Files",
    async (id) => {
      const slot = renderPanel();
      await slot.findAllByText("No pull request for this thread");

      act(() => runCommand(id));

      expect(selected(slot)).toBe("Files");
      expect(await slot.findByText("0 files changed")).toBeTruthy();
    },
  );

  it.each(["open-pr-tab", "refresh-pr"])("%s switches an open PR tab to Overview", (id) => {
    const slot = renderPanel();
    fireEvent.click(subTab(slot, "Files"));

    act(() => runCommand(id));

    expect(selected(slot)).toBe("Overview");
  });

  it("Open PR on GitHub keeps the sub-tab", () => {
    const slot = renderPanel();
    fireEvent.click(subTab(slot, "Files"));

    act(() => runCommand("open-pr-on-github"));

    expect(selected(slot)).toBe("Files");
  });
});

const openPr = (refreshedAt: number): InsightResult => ({
  kind: "ok",
  refreshedAt,
  error: null,
  insight: {
    pr: {
      number: 42,
      title: "Split the panel",
      state: "open",
      url: "https://github.com/o/r/pull/42",
      headOid: "def456",
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
    mergeQueue: null,
    autoMergeAction: { kind: "none" },
    canUpdateBranch: false,
    blockers: [],
    reviewers: [],
    checks: [],
  },
});

const timelineOf = (events: TimelineEvent[]): TimelineResult => ({
  kind: "ok",
  prNodeId: "PR_1",
  description: { body: "", author: "koenvg", at: "2026-10-01T09:00:00Z" },
  locked: false,
  viewerCanUpdate: true,
  events,
  olderCursor: null,
  newCommentIds: [],
});

function timelineReads(slot: Slot) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "getTimeline");
}

describe("PR panel Overview conversation", () => {
  it("shows the file count and an unresolved threads dot on the Files tab", async () => {
    const pr = openPr(1);
    const withThreads: InsightResult =
      pr.kind === "ok"
        ? {
            ...pr,
            insight: {
              ...pr.insight,
              pr: { ...pr.insight.pr, changedFiles: 18 },
              blockers: [{ code: "unresolved_threads", text: "1 unresolved thread" }],
            },
          }
        : pr;
    const slot = renderPanel("thr_1", { getInsight: () => withThreads });

    const files = subTab(slot, "Files");
    await vi.waitFor(() => expect(files.textContent).toContain("18"));
    expect(files.querySelector("[title='Unresolved review threads']")).toBeTruthy();
    expect(document.getElementById(files.getAttribute("aria-describedby")!)?.textContent).toBe(
      "18 changed files, unresolved review threads",
    );
  });

  it("shows the conversation below the PR status", async () => {
    const slot = renderPanel("thr_1", {
      getInsight: () => openPr(1),
      getTimeline: () => timelineOf([]),
    });

    expect(await slot.findByText("No conversation yet")).toBeTruthy();
    expect(slot.getByText("#42")).toBeTruthy();
  });

  it("keeps the PR status when the conversation read fails", async () => {
    const slot = renderPanel("thr_1", {
      getInsight: () => openPr(1),
      getTimeline: () => ({ kind: "error", message: "rate limited" }),
    });

    const alert = await slot.findByRole("alert");

    expect(alert.textContent).toContain("rate limited");
    expect(slot.getByText("#42")).toBeTruthy();
  });

  it("reads the conversation again when the PR status refreshes", async () => {
    let refreshedAt = 1;
    const slot = renderPanel("thr_1", {
      getInsight: () => openPr(refreshedAt),
      getTimeline: () => timelineOf([]),
    });
    await slot.findByText("No conversation yet");
    expect(timelineReads(slot)).toHaveLength(1);

    refreshedAt = 2;
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_1"] });

    await vi.waitFor(() => expect(timelineReads(slot)).toHaveLength(2));
  });
});

const reviewComment = (id: string) => ({
  id,
  author: "bob",
  avatarUrl: null,
  body: `comment ${id}`,
  createdAt: "2026-10-01T10:00:00Z",
  url: `https://github.com/o/r/pull/42#discussion_${id}`,
  diffHunk: "@@ -1 +1 @@",
});

const outdatedThread = (id: string, commentId: string, resolved: boolean): ReviewThread => ({
  id,
  resolved,
  outdated: true,
  path: "src/a.ts",
  line: null,
  originalLine: 1,
  side: "RIGHT",
  comments: [reviewComment(commentId)],
  hasMoreComments: false,
});

const bobReview: TimelineEvent = {
  kind: "review",
  id: "R1",
  actor: "bob",
  at: "2026-10-01T10:00:00Z",
  state: "changes_requested",
  body: "Split this",
  url: "https://github.com/o/r/pull/42#pullrequestreview-1",
  inlineCount: 2,
  inlineCommentIds: ["C2", "C3"],
};

function renderWithReview(threads: ReviewThread[]) {
  return renderPanel("thr_1", {
    getInsight: () => openPr(1),
    getTimeline: () => timelineOf([bobReview]),
    getReview: () => ({ ...emptyReview, threads: { placed: [], outdated: threads } }),
  });
}

function jumped(slot: Slot) {
  return Array.from(slot.container.querySelectorAll("[data-jumped]")).map((element) =>
    element.getAttribute("data-review-thread-id"),
  );
}

describe("PR panel review link", () => {
  it("shows Files and highlights the first thread of the review", async () => {
    const slot = renderWithReview([
      outdatedThread("T1", "C1", false),
      outdatedThread("T2", "C2", false),
      outdatedThread("T3", "C3", false),
    ]);

    fireEvent.click(await slot.findByRole("button", { name: "2 inline comments" }));

    expect(selected(slot)).toBe("Files");
    await vi.waitFor(() => expect(jumped(slot)).toEqual(["T2"]));
  });

  it("turns on Show resolved when all threads of the review are resolved", async () => {
    const slot = renderWithReview([
      outdatedThread("T2", "C2", true),
      outdatedThread("T3", "C3", true),
    ]);

    fireEvent.click(await slot.findByRole("button", { name: "2 inline comments" }));

    await vi.waitFor(() => expect(jumped(slot)).toEqual(["T2"]));
    expect(
      (slot.getByRole("checkbox", { name: "Show resolved" }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
