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

class Unobserved {
  observe() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", Unobserved);
  vi.stubGlobal("IntersectionObserver", Unobserved);
  // jsdom does not scroll.
  Element.prototype.scrollIntoView ??= () => {};
});

const app = await loadPluginApp(() => import("../app"));
const prTab = app.threadPanelActions.find((action) => action.id === "pr")!;

afterEach(() => {
  cleanup();
  forgetInsights();
  vi.restoreAllMocks();
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
        reReview: fail,
        markQueueSeen: fail,
        markThreadOpened: fail,
        hideRepo: fail,
        showRepo: fail,
        ignorePr: fail,
        unignorePr: fail,
        getViewerTeams: fail,
        setTeammatesTeam: fail,
        getReviewInstructions: () => ({ instructions: "unused", isDefault: true }),
        setReviewInstructions: fail,
        getAutoReview: () => ({ enabled: false, maxRunning: 3 }),
        getRepoImage: () => ({ kind: "absent" as const }),
        setAutoReview: fail,
        setWorkingToday: fail,
        getActivity: () => ({ kind: "loading" as const }),
        refreshActivity: () => ({ kind: "error" as const, message: "unused", lastGood: null }),
        markActivityRead: () => ({ kind: "error" as const, message: "unused" }),
        markActivityPrRead: () => ({ kind: "error" as const, message: "unused" }),
        markAllActivityRead: () => ({ kind: "error" as const, message: "unused" }),
        setActivityMuted: () => ({ kind: "error" as const, message: "unused" }),
        runPrAction: fail,
        localCommitsAhead: () => ({ kind: "unknown" }),
        getPrInsight: () => ({ kind: "no_pr" }),
        refreshPrInsight: () => ({ kind: "no_pr" }),
      },
    },
  );
}

type Slot = ReturnType<typeof renderPanel>;

function reviewCalls(slot: Slot) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "getReview");
}

const SECTION_ORDER = ["Description", "Conversation", "Files", "Status", "Checks"];

function sectionOrder(slot: Slot) {
  return Array.from(slot.container.querySelectorAll("section[aria-label]"))
    .map((section) => section.getAttribute("aria-label")!)
    .filter((label) => SECTION_ORDER.includes(label));
}

function scrolledIntoView() {
  const scrolled: Element[] = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
    scrolled.push(this);
  });
  return scrolled;
}

function labels(elements: readonly Element[]) {
  return elements.map((element) => element.getAttribute("aria-label"));
}

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

describe("PR panel", () => {
  it("registers one flush PR action and no Review action", () => {
    expect(app.threadPanelActions.map(({ id }) => id)).toEqual(["pr"]);
    expect(prTab).toMatchObject({ title: "PR", layout: "flush" });
  });

  it("shows one page with no sub-tabs", async () => {
    const slot = renderPanel("thr_1", { getInsight: () => openPr(1) });

    expect(await slot.findByText("0 files changed")).toBeTruthy();
    expect(slot.queryByRole("tablist")).toBeNull();
    expect(slot.queryByRole("tab")).toBeNull();
  });

  it("reads top to bottom: description, conversation, files, then the merge status", async () => {
    const slot = renderPanel("thr_1", {
      getInsight: () => openPr(1),
      getTimeline: () => timelineOf([]),
    });

    await slot.findByText("0 files changed");
    await slot.findByText("No conversation yet");

    expect(sectionOrder(slot)).toEqual(SECTION_ORDER);
    expect(slot.getByRole("heading", { level: 2 }).textContent).toBe("Split the panel");
  });

  it("shows the branch and diff size in the status part, not under the title", async () => {
    const slot = renderPanel("thr_1", { getInsight: () => openPr(1) });

    const status = await slot.findByRole("region", { name: "Status" });

    expect(within(status).getByText("feature → main")).toBeTruthy();
    expect(within(slot.getByTestId("pr-header")).queryByText("feature → main")).toBeNull();
  });

  it("reads the PR files once, with the page", async () => {
    const slot = renderPanel("thr_1", { getInsight: () => openPr(1) });

    await slot.findByText("0 files changed");

    expect(reviewCalls(slot)).toHaveLength(1);
  });

  it("shows no files without a PR", async () => {
    const slot = renderPanel();

    expect(await slot.findByText("No pull request for this thread")).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Files" })).toBeNull();
  });

  it("shows loading", () => {
    const never = () => new Promise<never>(() => {});
    const slot = renderPanel("thr_1", { getInsight: never, getReview: never });

    expect(slot.getByText("Loading pull request…")).toBeTruthy();
  });

  it("shows the read error with Retry", async () => {
    const slot = renderPanel("thr_1", {
      getInsight: () => ({ kind: "error", message: "gh not logged in" }),
    });

    expect(await slot.findByText("gh not logged in")).toBeTruthy();
    expect(slot.getByRole("button", { name: /Retry/ })).toBeTruthy();
  });

  it("scrolls to the files on a show-files intent and back to the top on show-overview", async () => {
    const scrolled = scrolledIntoView();
    const slot = renderPanel("thr_1", { getInsight: () => openPr(1) });
    await slot.findByText("0 files changed");
    const page = slot.container.querySelector<HTMLElement>("[data-diff-scroll-area]")!;

    act(() => postIntent("thr_1", "pr", "show-files"));
    expect(labels(scrolled)).toEqual(["Files"]);

    page.scrollTop = 500;
    act(() => postIntent("thr_1", "pr", "show-overview"));
    expect(page.scrollTop).toBe(0);
  });

  it("scrolls to the files once they show when the intent came first", async () => {
    const scrolled = scrolledIntoView();
    postIntent("thr_1", "pr", "show-files");

    const slot = renderPanel("thr_1", { getInsight: () => openPr(1) });

    await slot.findByText("0 files changed");
    expect(labels(scrolled)).toEqual(["Files"]);
  });
});

function runCommand(id: string, threadId = "thr_1") {
  const found = GITHUB_COMMANDS.find((entry) => entry.id === id)!;
  void found.run({ threadId, projectId: null, openPanel: () => true });
}

function renderOpenPr() {
  return renderPanel("thr_1", { getInsight: () => openPr(1) });
}

describe("PR panel palette commands", () => {
  it("Submit review opens a closed PR tab with the Submit panel", async () => {
    runCommand("submit-review");
    const slot = renderOpenPr();

    expect(await slot.findByRole("region", { name: "Submit review" })).toBeTruthy();
  });

  it("Submit review opens the Submit panel in an open PR tab", async () => {
    const slot = renderOpenPr();
    await slot.findByText("0 files changed");

    act(() => runCommand("submit-review"));

    expect(await slot.findByRole("region", { name: "Submit review" })).toBeTruthy();
  });

  it("does not open the Submit panel again after a remount", async () => {
    runCommand("submit-review");
    const first = renderOpenPr();
    await first.findByRole("region", { name: "Submit review" });
    fireEvent.click(first.getByRole("button", { name: "Submit review" }));
    first.lifecycle.unmount();

    const second = renderOpenPr();

    await second.findByText("0 files changed");
    expect(second.queryByRole("region", { name: "Submit review" })).toBeNull();
  });

  it("Open PR files scrolls to the files", async () => {
    const scrolled = scrolledIntoView();
    const slot = renderOpenPr();
    await slot.findByText("0 files changed");

    act(() => runCommand("open-pr-files"));

    expect(labels(scrolled)).toEqual(["Files"]);
  });

  it.each(["next-comment", "previous-comment", "refresh-pr", "open-pr-on-github"])(
    "%s keeps the scroll position",
    async (id) => {
      const scrolled = scrolledIntoView();
      const slot = renderOpenPr();
      await slot.findByText("0 files changed");
      const page = slot.container.querySelector<HTMLElement>("[data-diff-scroll-area]")!;
      page.scrollTop = 500;

      act(() => runCommand(id));

      expect(page.scrollTop).toBe(500);
      expect(scrolled).toEqual([]);
    },
  );
});

describe("PR panel Overview conversation", () => {
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
  it("scrolls to the first thread of the review and highlights it", async () => {
    const slot = renderWithReview([
      outdatedThread("T1", "C1", false),
      outdatedThread("T2", "C2", false),
      outdatedThread("T3", "C3", false),
    ]);

    fireEvent.click(await slot.findByRole("button", { name: "2 inline comments" }));

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
