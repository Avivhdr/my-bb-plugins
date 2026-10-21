// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, renderHook, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { ActionResult, InsightResult, ReturnedReason, rpcContract } from "./contract";
import type { Check } from "./core/checks";
import type { PrInsight } from "./core/overview";
import { postIntent, useCommandIntent } from "./ui/command-intents";
import { GITHUB_COMMANDS } from "./ui/commands";
import { forgetInsights } from "./ui/pr-availability";

const app = await loadPluginApp(() => import("./app"));
const prTab = app.threadPanelActions.find((action) => action.id === "pr")!;

afterEach(() => {
  cleanup();
  forgetInsights();
});

function check(name: string, status: Check["status"], failure: Check["failure"] = null): Check {
  return { name, status, url: `https://github.com/o/r/runs/${name}`, required: false, failure };
}

const pr = {
  number: 25337,
  title: "feat(*): add ootbDomainTypesIds constants",
  state: "open",
  url: "https://github.com/collibra/frontend/pull/25337",
  headOid: "2c850077d3529aa67c8178c80d09517377124ea9",
  headRefName: "feature",
  headOwner: null,
  isCrossRepository: false,
  baseRefName: "main",
  author: "koenvg",
  additions: 1,
  deletions: 0,
  changedFiles: 1,
} as const;

const queuePrRow = {
  repo: "acme/api",
  number: 15,
  title: "Add rate limits",
  author: "alice",
  createdAt: "2026-10-01T10:00:00Z",
  updatedAt: "2026-10-01T10:00:00Z",
  draft: false,
  ci: "passed",
  reviewDecision: "REVIEW_REQUIRED",
  headRefName: "rate-limits",
  headOid: "head-15",
  url: "https://github.com/acme/api/pull/15",
  state: "open",
  closedAt: null,
  requested: true,
  projectIds: [],
  review: "needs_review",
} as const;

const emptyInsight: PrInsight = {
  pr,
  mergeAction: { kind: "none" },
  blockers: [],
  reviewers: [],
  checks: [],
  mergeQueue: null,
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
};

const unusedReviewRpc = {
  getPrVideo: () => ({ kind: "error" as const, code: "read" as const, message: "unavailable" }),
  getPrImage: () => ({ kind: "error" as const, code: "read" as const, message: "unavailable" }),
  getReview: () => ({ kind: "no_pr" as const }),
  getDrafts: () => ({ kind: "no_pr" as const }),
  getTimeline: () => ({ kind: "no_pr" as const }),
  addPrComment: () => ({ kind: "error" as const, message: "unused" }),
  sendToAgent: () => ({ kind: "error" as const, message: "unused" }),
  reply: () => ({ kind: "post_failed" as const, message: "unused" }),
  setResolved: () => ({ kind: "error" as const, message: "unused" }),
  saveDraft: () => ({ kind: "error" as const, message: "unused" }),
  discardDraft: () => ({ kind: "error" as const, message: "unused" }),
  createCommentDraft: () => ({ kind: "error" as const, message: "unused" }),
  saveCommentDraft: () => ({ kind: "error" as const, message: "unused" }),
  deleteCommentDraft: () => ({ kind: "error" as const, message: "unused" }),
  saveSummaryDraft: () => ({ kind: "error" as const, message: "unused" }),
  updateViewed: () => ({ kind: "error" as const, message: "unused" }),
  markCommentsSeen: () => ({ kind: "error" as const, message: "unused" }),
  submitReview: () => ({ kind: "error" as const, message: "unused", url: null }),
  getReviewQueue: () => ({ kind: "error" as const, message: "unused", lastGood: null }),
  refreshReviewQueue: () => ({ kind: "error" as const, message: "unused", lastGood: null }),
  startReview: () => ({ threadId: "unused" }),
  getPrimaryHost: () => ({ hostId: null }),
  archiveReview: () => ({ kind: "error" as const, message: "unused" }),
  markReviewed: () => ({ kind: "error" as const, message: "unused" }),
  markNeedsReview: () => ({ kind: "error" as const, message: "unused" }),
  markQueueSeen: () => ({ kind: "error" as const, message: "unused" }),
  markThreadOpened: () => ({ kind: "error" as const, message: "unused" }),
  runPrAction: () => ({ kind: "error" as const, message: "unused" }),
  localCommitsAhead: () => ({ kind: "unknown" as const }),
  getPrInsight: () => ({ kind: "no_pr" as const }),
  refreshPrInsight: () => ({ kind: "no_pr" as const }),
};

const REFRESHED_AT = Date.parse("2026-09-24T10:00:00Z");

function ok(insight: PrInsight, error: string | null = null): InsightResult {
  return { kind: "ok", insight, refreshedAt: REFRESHED_AT, error };
}

const insight = ok({
  pr,
  mergeAction: { kind: "none" },
  blockers: [
    { code: "checks_failed", text: "1 check failed" },
    { code: "review_required", text: "Review required" },
  ],
  reviewers: [
    { name: "ai-governance", kind: "team", state: "pending", codeOwner: true },
    { name: "alice", kind: "user", state: "approved", codeOwner: false },
  ],
  checks: [
    check("lint", "passed"),
    check("a11y-test", "failed", {
      reason: "Process completed with exit code 1.",
      annotations: [
        { path: ".github", line: 4092, message: "Process completed with exit code 1." },
      ],
      annotationCount: 1,
    }),
    check("e2e", "cancelled", { reason: "", annotations: [], annotationCount: 0 }),
    check("build", "running"),
    check("container", "skipped"),
    check("typecheck", "passed"),
  ],
  mergeQueue: null,
  autoMergeAction: { kind: "none" },
  canUpdateBranch: false,
});

function insightMethods(slot: { inspection: { rpcCalls: { method: string }[] } }) {
  return slot.inspection.rpcCalls
    .map((call) => call.method)
    .filter((method) => method !== "getTimeline");
}

function renderTab(
  result: InsightResult | (() => InsightResult | Promise<InsightResult>),
  refresh: () => InsightResult | Promise<InsightResult> = () => ({ kind: "no_pr" }),
) {
  const getInsight = typeof result === "function" ? result : () => result;
  return renderSlot<PluginThreadPanelProps, typeof rpcContract>(
    prTab,
    { threadId: "thr_1", params: null },
    { rpc: { getInsight, refresh, ...unusedReviewRpc } },
  );
}

describe("palette commands", () => {
  it("registers the GitHub commands in the command palette", () => {
    const { commandPaletteActions } = app as unknown as { commandPaletteActions: { id: string }[] };

    expect(commandPaletteActions.map(({ id }) => id)).toEqual([
      "merge-pr",
      "open-pr-tab",
      "open-pr-files",
      "submit-review",
      "next-comment",
      "previous-comment",
      "refresh-pr",
      "open-pr-on-github",
    ]);
  });
});

describe("PR tab", () => {
  it("asks for the insight of its own thread", async () => {
    const slot = renderTab({ kind: "no_pr" });

    await slot.findByText("No pull request for this thread");
    expect(slot.inspection.rpcCalls).toEqual([
      expect.objectContaining({
        method: "getInsight",
        input: { threadId: "thr_1" },
      }),
    ]);
  });

  it("shows the PR number, title, state, and link", async () => {
    const slot = renderTab(insight);

    await slot.findByText("feat(*): add ootbDomainTypesIds constants");
    expect(slot.getByText("#25337")).toBeTruthy();
    expect(slot.getByText("Open")).toBeTruthy();
    expect(slot.getByRole("link", { name: /open on github/i }).getAttribute("href")).toBe(
      "https://github.com/collibra/frontend/pull/25337",
    );
  });

  it("makes the merged outcome explicit while keeping PR details and checks visible", async () => {
    const slot = renderTab(
      ok({
        ...emptyInsight,
        pr: { ...pr, state: "merged" },
        checks: [check("lint", "passed")],
      }),
    );

    const heading = await slot.findByRole("heading", { name: "Pull request merged" });
    expect(heading.closest('[role="status"]')).toBeTruthy();
    expect(slot.getByText("#25337")).toBeTruthy();
    expect(slot.getByRole("heading", { name: pr.title })).toBeTruthy();
    expect(slot.getByRole("link", { name: "Open on GitHub" }).getAttribute("href")).toBe(pr.url);
    expect(slot.getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(slot.getByTestId("check-group-heading").textContent).toBe("1 passed");
    expect(slot.queryByText("Merged", { exact: true })).toBeNull();
    expect(slot.queryByRole("button", { name: /merge/i })).toBeNull();
  });

  it.each([
    ["open", "Open"],
    ["draft", "Draft"],
    ["closed", "Closed"],
  ] as const)("does not show a merged outcome for a %s PR", async (state, label) => {
    const slot = renderTab(ok({ ...emptyInsight, pr: { ...pr, state } }));

    await slot.findByText(label);
    expect(slot.queryByRole("heading", { name: "Pull request merged" })).toBeNull();
  });

  it("shows the header, the merge status with the reviewers, and the checks in this order", async () => {
    const slot = renderTab(insight);

    await slot.findByText("#25337");
    await settle();
    const sections = slot
      .getAllByRole("region")
      .map((section) => section.getAttribute("aria-label"));
    expect(sections).toEqual(["Merge status", "Checks"]);
  });

  it("lists the merge blockers in order", async () => {
    const slot = renderTab(insight);

    const blockers = await slot.findByRole("list", { name: "Merge blockers" });
    expect(
      Array.from(blockers.querySelectorAll(":scope > li"), (item) => item.textContent),
    ).toEqual([
      expect.stringContaining("1 check failed"),
      expect.stringContaining("Review required"),
    ]);
  });

  it("shows a pending code owner team with its labels", async () => {
    const slot = renderTab(insight);

    const row = (await slot.findByText("ai-governance (team)")).closest("li")!;
    expect(within(row).getByText("Pending")).toBeTruthy();
    expect(within(row).getByText("code owner")).toBeTruthy();
  });

  it("shows an approved user without the code owner label", async () => {
    const slot = renderTab(insight);

    const row = (await slot.findByText("alice")).closest("li")!;
    expect(within(row).getByText("Approved")).toBeTruthy();
    expect(within(row).queryByText("code owner")).toBeNull();
  });

  it("leaves out the blockers and reviewers of a PR without them", async () => {
    const slot = renderTab(ok({ ...emptyInsight, checks: [check("lint", "passed")] }));

    await slot.findByText("#25337");
    expect(slot.queryByRole("list", { name: "Merge blockers" })).toBeNull();
    expect(slot.queryByRole("region", { name: "Reviewers" })).toBeNull();
  });

  it("groups checks by status, with the failed checks in the merge status card", async () => {
    const slot = renderTab(insight);

    await slot.findByText("#25337");
    const headings = slot
      .getAllByTestId("check-group-heading")
      .map((heading) => heading.textContent);
    expect(headings).toEqual(["1 cancelled", "1 running", "2 passed, 1 skipped"]);
  });

  it("shows a waiting check open with its own icon and no spinner", async () => {
    const slot = renderTab(
      ok({ ...emptyInsight, checks: [check("UI Review", "waiting"), check("lint", "passed")] }),
    );

    const row = (await slot.findByRole("link", { name: "UI Review" })).closest("li")!;
    expect(slot.getAllByTestId("check-group-heading").map((h) => h.textContent)).toEqual([
      "1 waiting",
      "1 passed",
    ]);
    expect(row.querySelector('[data-icon="UserRound"]')).toBeTruthy();
    expect(row.querySelector('[data-icon="Spinner"]')).toBeNull();
  });

  it("links each check to GitHub", async () => {
    const slot = renderTab(insight);
    fireEvent.click(await slot.findByRole("button", { name: /1 check failed/ }));

    const link = await slot.findByRole("link", { name: "a11y-test" });
    expect(link.getAttribute("href")).toBe("https://github.com/o/r/runs/a11y-test");
  });

  it("collapses passed and skipped checks until the user expands them", async () => {
    const slot = renderTab(insight);

    const collapsed = (await slot.findByText("2 passed, 1 skipped")).closest("details")!;
    expect(collapsed.open).toBe(false);

    fireEvent.click(within(collapsed).getByText("2 passed, 1 skipped"));
    expect(collapsed.open).toBe(true);
    expect(within(collapsed).getByText("lint")).toBeTruthy();
  });

  it("shows the annotations of a failed check without repeating the reason", async () => {
    const slot = renderTab(insight);
    fireEvent.click(await slot.findByRole("button", { name: /1 check failed/ }));

    const row = (await slot.findByRole("link", { name: "a11y-test" })).closest("li")!;
    expect(within(row).getByText(".github:4092")).toBeTruthy();
    expect(within(row).queryByTestId("check-reason")).toBeNull();
    expect(within(row).getAllByText(/Process completed with exit code 1\./)).toHaveLength(1);
  });

  it("keeps the link of a cancelled check without reason text", async () => {
    const slot = renderTab(insight);

    const row = (await slot.findByRole("link", { name: "e2e" })).closest("li")!;
    expect(within(row).queryByTestId("check-reason")).toBeNull();
  });

  it("says how many more annotations there are", async () => {
    const annotations = Array.from({ length: 5 }, (_, index) => ({
      path: "src/app.ts",
      line: index + 1,
      message: `error ${index + 1}`,
    }));
    const slot = renderTab(
      ok({
        ...emptyInsight,
        checks: [
          check("lint", "failed", {
            reason: "error 1",
            annotations,
            annotationCount: 12,
          }),
        ],
      }),
    );

    await slot.findByText("7 more");
    expect(slot.getAllByTestId("check-annotation")).toHaveLength(5);
  });

  it("shows the error text when the insight cannot be read", async () => {
    const slot = renderTab({ kind: "error", message: "gh not logged in" });

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("gh not logged in")).toBeTruthy();
  });

  it("retries a failed read with a manual refresh", async () => {
    const slot = renderTab({ kind: "error", message: "gh not installed" }, () => insight);

    fireEvent.click(await slot.findByRole("button", { name: "Retry" }));

    await slot.findByText("#25337");
    expect(insightMethods(slot)).toEqual(["getInsight", "refresh"]);
  });

  it("keeps the last good data with its time when the last refresh failed", async () => {
    const slot = renderTab(ok(emptyInsight, "rate limited"));

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("rate limited")).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(
      within(alert)
        .getByText(/last updated/i)
        .querySelector("time")?.dateTime,
    ).toBe("2026-09-24T10:00:00.000Z");
    expect(slot.getByText("#25337")).toBeTruthy();
  });

  it("does not show a refresh time while the data is current", async () => {
    const slot = renderTab(insight);

    await slot.findByText("#25337");
    expect(slot.queryByText(/last updated/i)).toBeNull();
  });

  it("shows progress during a manual refresh and then the new data", async () => {
    let finish: (result: InsightResult) => void = () => {};
    const slot = renderTab(insight, () => new Promise((resolve) => (finish = resolve)));

    fireEvent.click(await slot.findByRole("button", { name: "Refresh" }));

    const busy = await slot.findByRole("button", { name: "Refreshing…" });
    expect(busy).toHaveProperty("disabled", true);
    await act(async () => finish(ok({ ...emptyInsight, pr: { ...pr, state: "merged" } })));
    await slot.findByText("Pull request merged");
    expect(slot.getByRole("button", { name: "Refresh" })).toHaveProperty("disabled", false);
  });

  it("does not show another thread's refresh as in progress", async () => {
    const slot = renderTab(insight, () => new Promise<InsightResult>(() => {}));
    fireEvent.click(await slot.findByRole("button", { name: "Refresh" }));
    await slot.findByRole("button", { name: "Refreshing…" });

    const Tab = prTab.component;
    slot.lifecycle.rerender(<Tab threadId="thr_2" params={null} />);

    expect(await slot.findByRole("button", { name: "Refresh" })).toHaveProperty("disabled", false);
  });

  it("shows new data when the server says this thread's insight changed", async () => {
    let current = insight;
    const slot = renderTab(() => current);
    await slot.findByText("Open");

    current = ok({ ...emptyInsight, pr: { ...pr, state: "merged" } });
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_1"] });

    await slot.findByText("Pull request merged");
  });

  it("ignores insight changes of other threads", async () => {
    const slot = renderTab(insight);
    await slot.findByText("Open");

    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_2"] });

    expect(insightMethods(slot)).toHaveLength(1);
  });

  it.each([
    ["queued", "In merge queue (#3)"],
    ["awaiting_checks", "Merge queue checks running (#3)"],
    ["merging", "Merging"],
    ["failed", "Merge queue failed"],
  ] as const)("shows the %s queue state as text instead of merge blockers", async (state, text) => {
    const slot = renderTab(ok({ ...emptyInsight, mergeQueue: { position: 3, state } }));

    const summary = await slot.findByRole("status", { name: "Merge verdict" });
    expect(summary.textContent).toBe(text);
    expect(slot.queryByRole("list", { name: "Merge blockers" })).toBeNull();
  });

  it("shows a failed queue entry in the problem tone", async () => {
    const slot = renderTab(ok({ ...emptyInsight, mergeQueue: { position: 1, state: "failed" } }));

    const summary = await slot.findByRole("status", { name: "Merge verdict" });
    expect(within(summary).getByText("Merge queue failed").className).toContain("text-destructive");
  });

  it("leaves out the merge queue of a PR that is not queued", async () => {
    const slot = renderTab(insight);

    await slot.findByRole("list", { name: "Merge blockers" });
    expect(slot.queryByRole("region", { name: "Merge queue" })).toBeNull();
  });

  it("says so when the PR has no checks", async () => {
    const slot = renderTab(ok(emptyInsight));

    await slot.findByText("No checks on the head commit");
  });
});

const readyInsight = ok({ ...emptyInsight, mergeAction: { kind: "merge", method: "SQUASH" } });

function renderMergeTab({
  runPrAction = () => ({ kind: "ok" }),
  result = () => readyInsight,
}: {
  runPrAction?: () => ActionResult | Promise<ActionResult>;
  result?: () => InsightResult;
} = {}) {
  return renderSlot<PluginThreadPanelProps, typeof rpcContract>(
    prTab,
    { threadId: "thr_1", params: null },
    {
      rpc: {
        getInsight: result,
        refresh: result,
        ...unusedReviewRpc,
        runPrAction,
      },
    },
  );
}

const rejectedMerge = {
  kind: "error",
  message: "Head branch was modified. Review and try the merge again.",
} as const;

function mergeCalls(slot: ReturnType<typeof renderMergeTab>) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "runPrAction");
}

async function openMergeDialog(slot: ReturnType<typeof renderMergeTab>) {
  fireEvent.click(await slot.findByRole("button", { name: "Squash and merge" }));
  return slot.findByRole("alertdialog");
}

describe("PR tab merge", () => {
  it("names the default merge method on the button", async () => {
    const slot = renderMergeTab();

    expect(await slot.findByRole("button", { name: "Squash and merge" })).toBeTruthy();
  });

  it.each([
    ["merge commit", "MERGE", "Create merge commit"],
    ["rebase", "REBASE", "Rebase and merge"],
  ] as const)("labels a %s default", async (_, method, label) => {
    const slot = renderMergeTab({
      result: () => ok({ ...emptyInsight, mergeAction: { kind: "merge", method } }),
    });

    expect(await slot.findByRole("button", { name: label })).toBeTruthy();
  });

  it("shows no merge button when the PR offers no merge", async () => {
    const slot = renderMergeTab({ result: () => ok(emptyInsight) });

    await slot.findByText("#25337");
    expect(slot.queryByRole("button", { name: /merge/i })).toBeNull();
  });

  it("asks to confirm with the PR number, title, and method", async () => {
    const slot = renderMergeTab();

    const dialog = await openMergeDialog(slot);

    expect(within(dialog).getByText("Merge pull request #25337?")).toBeTruthy();
    expect(within(dialog).getByText(pr.title)).toBeTruthy();
    expect(within(dialog).getByText("Method: Squash and merge")).toBeTruthy();
    expect(mergeCalls(slot)).toEqual([]);
  });

  it("sends no merge when the user cancels", async () => {
    const slot = renderMergeTab();

    const dialog = await openMergeDialog(slot);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(slot.queryByRole("alertdialog")).toBeNull();
    expect(mergeCalls(slot)).toEqual([]);
  });

  it("sends one merge with the head commit the tab showed when the user confirms", async () => {
    const slot = renderMergeTab();

    const dialog = await openMergeDialog(slot);
    const confirm = within(dialog).getByRole("button", { name: "Squash and merge" });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(mergeCalls(slot)).toEqual([
      expect.objectContaining({
        input: { threadId: "thr_1", action: "merge", expectedHeadOid: pr.headOid },
      }),
    ]);
  });

  it("disables the button while the merge runs", async () => {
    let finish: (result: ActionResult) => void = () => {};
    const slot = renderMergeTab({
      runPrAction: () => new Promise((resolve) => (finish = resolve)),
    });

    const dialog = await openMergeDialog(slot);
    fireEvent.click(within(dialog).getByRole("button", { name: "Squash and merge" }));

    const busy = await slot.findByRole("button", { name: "Merging…" });
    expect(busy).toHaveProperty("disabled", true);
    fireEvent.click(busy);
    await act(async () => finish({ kind: "ok" }));
    expect(mergeCalls(slot)).toHaveLength(1);
  });

  it("shows the GitHub error and gives the button back when the merge fails", async () => {
    const slot = renderMergeTab({ runPrAction: () => rejectedMerge });

    const dialog = await openMergeDialog(slot);
    fireEvent.click(within(dialog).getByRole("button", { name: "Squash and merge" }));

    expect((await slot.findByRole("alert")).textContent).toBe(rejectedMerge.message);
    expect(slot.getByRole("button", { name: "Squash and merge" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("drops the merge error once the tab shows a new head commit", async () => {
    let current = readyInsight;
    const slot = renderMergeTab({ runPrAction: () => rejectedMerge, result: () => current });
    const dialog = await openMergeDialog(slot);
    fireEvent.click(within(dialog).getByRole("button", { name: "Squash and merge" }));
    await slot.findByRole("alert");

    current = ok({
      ...emptyInsight,
      pr: { ...pr, headOid: "9f1e" },
      mergeAction: { kind: "merge", method: "SQUASH" },
    });
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_1"] });

    expect(slot.queryByRole("alert")).toBeNull();
  });
});

const enqueueInsight = ok({ ...emptyInsight, mergeAction: { kind: "enqueue" } });

describe("PR tab enqueue", () => {
  it("shows an enqueue button and no merge button for a ready PR on a merge queue branch", async () => {
    const slot = renderMergeTab({ result: () => enqueueInsight });

    expect(await slot.findByRole("button", { name: "Enqueue" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /merge/i })).toBeNull();
  });

  it("sends one enqueue with the head commit the tab showed, without a dialog", async () => {
    const slot = renderMergeTab({ result: () => enqueueInsight });

    const enqueue = await slot.findByRole("button", { name: "Enqueue" });
    await act(async () => {
      fireEvent.click(enqueue);
      fireEvent.click(enqueue);
    });

    expect(slot.queryByRole("alertdialog")).toBeNull();
    expect(mergeCalls(slot)).toEqual([
      expect.objectContaining({
        input: { threadId: "thr_1", action: "enqueue", expectedHeadOid: pr.headOid },
      }),
    ]);
  });

  it("disables the button while the enqueue runs", async () => {
    let finish: (result: ActionResult) => void = () => {};
    const slot = renderMergeTab({
      result: () => enqueueInsight,
      runPrAction: () => new Promise((resolve) => (finish = resolve)),
    });

    fireEvent.click(await slot.findByRole("button", { name: "Enqueue" }));

    expect(await slot.findByRole("button", { name: "Enqueuing…" })).toHaveProperty(
      "disabled",
      true,
    );
    await act(async () => finish({ kind: "ok" }));
  });

  it("shows the GitHub error and gives the button back when the enqueue fails", async () => {
    const message = "Pull request is not mergeable";
    const slot = renderMergeTab({
      result: () => enqueueInsight,
      runPrAction: () => ({ kind: "error", message }),
    });

    fireEvent.click(await slot.findByRole("button", { name: "Enqueue" }));

    expect((await slot.findByRole("alert")).textContent).toBe(message);
    expect(slot.getByRole("button", { name: "Enqueue" })).toHaveProperty("disabled", false);
  });

  it("shows Queued once the refresh after the enqueue arrives", async () => {
    let current = enqueueInsight;
    const slot = renderMergeTab({ result: () => current });

    fireEvent.click(await slot.findByRole("button", { name: "Enqueue" }));
    current = ok({
      ...emptyInsight,
      mergeAction: { kind: "queued" },
      mergeQueue: { position: 1, state: "queued" },
    });
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_1"] });

    await slot.findByText("In merge queue (#1)");
    expect(slot.queryByRole("button", { name: "Enqueue" })).toBeNull();
  });

  it("shows Queued and no button for a queued PR with running checks", async () => {
    const slot = renderMergeTab({
      result: () =>
        ok({
          ...emptyInsight,
          mergeAction: { kind: "queued" },
          checks: [check("build", "running")],
          mergeQueue: { position: 2, state: "awaiting_checks" },
        }),
    });

    await slot.findByText("Merge queue checks running (#2)");
    expect(
      slot.queryByRole("button", {
        name: /^(Enqueue|Squash and merge|Rebase and merge|Create merge commit)$/i,
      }),
    ).toBeNull();
  });
});

const banner = app.composerCustomizations
  .find((customization) => customization.id === "pr-insight")!
  .banners!.find((entry) => entry.id === "merge-blockers")!;

function renderBanner(
  result: InsightResult | (() => InsightResult),
  runPrAction: () => ActionResult | Promise<ActionResult> = () => ({ kind: "ok" }),
) {
  const getInsight = typeof result === "function" ? result : () => result;
  return renderSlot<object, typeof rpcContract>(
    banner,
    {},
    {
      rpc: { getInsight, refresh: getInsight, ...unusedReviewRpc, runPrAction },
      composer: { scope: { kind: "thread", threadId: "thr_1" } },
      openThreadPanel: () => true,
    },
  );
}

const blocked: PrInsight = {
  ...emptyInsight,
  blockers: [
    { code: "checks_failed", text: "2 checks failed" },
    { code: "behind", text: "Branch out of date" },
    { code: "review_required", text: "Review required" },
  ],
  reviewers: [{ name: "ai-governance", kind: "team", state: "pending", codeOwner: true }],
};
const blockedInsight = ok(blocked);

function insightCalls(slot: ReturnType<typeof renderBanner>) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "getInsight");
}

async function settled(slot: ReturnType<typeof renderBanner>) {
  await act(async () => {});
  expect(insightCalls(slot)).toHaveLength(1);
}

describe("Composer banner", () => {
  it("shows only on thread composers", () => {
    expect(
      app.composerCustomizations.find((customization) => customization.id === "pr-insight"),
    ).toMatchObject({ scopes: ["thread"] });
  });

  function openedCalls(slot: ReturnType<typeof renderBanner>) {
    return slot.inspection.rpcCalls
      .filter((call) => call.method === "markThreadOpened")
      .map((call) => call.input);
  }

  function queueWithThread(status: "idle" | "needs_you", returned: ReturnedReason | null) {
    const pr = { ...queuePrRow, thread: { id: "thr_1", status, isReviewThread: true, returned } };
    return {
      kind: "ok",
      needsReview: [{ repo: "acme/api", prs: [pr] }],
      reviewed: [],
      truncated: false,
      loadedAt: 1,
      hasUnseen: false,
      hasReturned: returned !== null,
    };
  }

  it("reports its thread as opened", async () => {
    const slot = renderBanner(blockedInsight);

    await vi.waitFor(() => expect(openedCalls(slot)).toEqual([{ threadId: "thr_1" }]));
  });

  it("reports again when the open thread's agent comes back", async () => {
    const slot = renderBanner(blockedInsight);
    await vi.waitFor(() => expect(openedCalls(slot)).toHaveLength(1));

    await slot.behavior.emitRealtime("review-queue.updated", queueWithThread("idle", null));
    expect(openedCalls(slot)).toHaveLength(1);

    await slot.behavior.emitRealtime("review-queue.updated", queueWithThread("idle", "finished"));
    await vi.waitFor(() => expect(openedCalls(slot)).toHaveLength(2));
  });

  it("does not report a returned thread that waits for the user", async () => {
    const slot = renderBanner(blockedInsight);
    await vi.waitFor(() => expect(openedCalls(slot)).toHaveLength(1));

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      queueWithThread("needs_you", "needs_you"),
    );

    expect(openedCalls(slot)).toHaveLength(1);
  });

  it("shows failed checks, pending review, and an out of date branch", async () => {
    const slot = renderBanner(blockedInsight);

    const button = await slot.findByRole("button");
    expect(button.textContent).toContain("2 checks failed");
    expect(button.textContent).toContain("1 review pending");
    expect(button.textContent).toContain("Branch out of date");
    expect(button.textContent).not.toContain("Review required");
  });

  it("opens the PR tab on click", async () => {
    const slot = renderBanner(blockedInsight);

    fireEvent.click(await slot.findByRole("button"));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]);
  });

  it("opens the PR tab on Overview", async () => {
    const subTab: string[] = [];
    renderHook(() => useCommandIntent("thr_1", "pr", (intent) => subTab.push(intent)));
    const slot = renderBanner(blockedInsight);
    const button = await slot.findByRole("button");
    subTab.length = 0;

    fireEvent.click(button);

    expect(subTab).toEqual(["show-overview"]);
  });

  it("asks for the insight of the composer's thread", async () => {
    const slot = renderBanner(blockedInsight);

    await slot.findByRole("button");
    expect(insightCalls(slot)).toEqual([
      expect.objectContaining({ method: "getInsight", input: { threadId: "thr_1" } }),
    ]);
  });

  it("shows Open without readiness when no action is available", async () => {
    const slot = renderBanner(ok(emptyInsight));

    await settled(slot);
    expect(slot.getByRole("button", { name: "Open" })).toBeTruthy();
  });

  it("is hidden when the thread has no PR", async () => {
    const slot = renderBanner({ kind: "no_pr" });

    await settled(slot);
    expect(slot.queryByRole("button")).toBeNull();
  });

  it("shows a merged PR banner that opens the PR tab without writing to GitHub", async () => {
    const slot = renderBanner(ok({ ...blocked, pr: { ...pr, state: "merged" } }));

    const button = await slot.findByRole("button", { name: "Pull request merged" });
    expect(slot.getAllByRole("button")).toHaveLength(1);
    expect(button.querySelector('[data-icon="GitMerge"]')).toBeTruthy();
    fireEvent.click(button);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]);
    expect(slot.inspection.rpcCalls.some(({ method }) => method === "runPrAction")).toBe(false);
  });

  it("shows Closed without obsolete blockers", async () => {
    const slot = renderBanner(ok({ ...blocked, pr: { ...pr, state: "closed" } }));

    await settled(slot);
    expect(slot.getByRole("button", { name: "Closed" })).toBeTruthy();
  });

  it("shows the read error and Retry without a merge action", async () => {
    const slot = renderBanner({ kind: "error", message: "gh not logged in" });

    await settled(slot);
    expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(slot.getByRole("alert").textContent).toContain("gh not logged in");
    expect(slot.queryByRole("button", { name: /merge|enqueue/i })).toBeNull();
  });

  it("keeps showing the last good data when the last refresh failed", async () => {
    const slot = renderBanner(ok(blocked, "rate limited"));

    expect((await slot.findByRole("button", { name: /Open/ })).textContent).toContain(
      "2 checks failed",
    );
  });

  it("updates when the server says this thread's insight changed", async () => {
    let current: InsightResult = blockedInsight;
    const slot = renderBanner(() => current);
    await slot.findByRole("button");

    current = ok(emptyInsight);
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_1"] });

    expect(slot.getByRole("button", { name: "Open" })).toBeTruthy();
  });
});

const readyBanner = ok({ ...emptyInsight, mergeAction: { kind: "merge", method: "SQUASH" } });

function bannerMergeCalls(slot: ReturnType<typeof renderBanner>) {
  return slot.inspection.rpcCalls.filter((call) => call.method === "runPrAction");
}

describe("Composer banner merge action", () => {
  it("shows Ready to merge and the merge button for a ready PR", async () => {
    const slot = renderBanner(readyBanner);

    expect(await slot.findByRole("button", { name: /Ready to merge/ })).toBeTruthy();
    expect(slot.getByRole("button", { name: "Squash and merge" })).toBeTruthy();
  });

  it("opens the PR tab and sends no write when the user clicks the text", async () => {
    const slot = renderBanner(readyBanner);

    fireEvent.click(await slot.findByRole("button", { name: /Ready to merge/ }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openThreadPanel", options: { actionId: "pr" } },
    ]);
    expect(bannerMergeCalls(slot)).toEqual([]);
  });

  it("sends one merge with the shown head commit when the user confirms", async () => {
    const slot = renderBanner(readyBanner);

    fireEvent.click(await slot.findByRole("button", { name: "Squash and merge" }));
    const dialog = await slot.findByRole("alertdialog");
    expect(bannerMergeCalls(slot)).toEqual([]);
    const confirm = within(dialog).getByRole("button", { name: "Squash and merge" });
    await act(async () => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });

    expect(bannerMergeCalls(slot)).toEqual([
      expect.objectContaining({
        input: { threadId: "thr_1", action: "merge", expectedHeadOid: pr.headOid },
      }),
    ]);
  });

  it("sends one enqueue without a dialog for a ready PR on a merge queue branch", async () => {
    const slot = renderBanner(ok({ ...emptyInsight, mergeAction: { kind: "enqueue" } }));

    expect(await slot.findByRole("button", { name: /Ready to enqueue/ })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Enqueue" }));
    await act(async () => {});

    expect(slot.queryByRole("alertdialog")).toBeNull();
    expect(bannerMergeCalls(slot)).toEqual([
      expect.objectContaining({
        input: { threadId: "thr_1", action: "enqueue", expectedHeadOid: pr.headOid },
      }),
    ]);
  });

  it("shows Queued and no merge or enqueue button for a queued PR", async () => {
    const slot = renderBanner(
      ok({
        ...emptyInsight,
        mergeAction: { kind: "queued" },
        checks: [check("build", "running")],
        mergeQueue: { position: 2, state: "awaiting_checks" },
      }),
    );

    expect(
      await slot.findByRole("button", { name: "Open: Merge queue checks running (#2)" }),
    ).toBeTruthy();
    expect(
      slot.queryByRole("button", {
        name: /^(Enqueue|Squash and merge|Rebase and merge|Create merge commit)$/i,
      }),
    ).toBeNull();
  });

  it("shows the blockers and no merge button for a PR with blockers", async () => {
    const slot = renderBanner(blockedInsight);

    expect((await slot.findByRole("button")).textContent).toContain("2 checks failed");
    expect(slot.queryByRole("button", { name: /merge|enqueue/i })).toBeNull();
  });

  it("replaces the merge controls with the merged banner once the PR is merged", async () => {
    let current: InsightResult = readyBanner;
    const slot = renderBanner(() => current);
    await slot.findByRole("button", { name: /Ready to merge/ });

    current = ok({ ...emptyInsight, pr: { ...pr, state: "merged" } });
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_1"] });

    expect(await slot.findByRole("button", { name: "Pull request merged" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Ready to merge/ })).toBeNull();
    expect(slot.queryByRole("button", { name: "Squash and merge" })).toBeNull();
    expect(slot.getAllByRole("button")).toHaveLength(1);
  });

  it.each([
    ["ready", readyBanner],
    ["queued", ok({ ...emptyInsight, mergeAction: { kind: "queued" } })],
    ["blocked", blockedInsight],
  ])("puts no button inside another button for a %s PR", async (_, result) => {
    const slot = renderBanner(result);

    await slot.findAllByRole("button");
    expect(slot.container.querySelector("button button")).toBeNull();
  });
});

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)));

describe("palette command availability", () => {
  const listed = (threadId: string) =>
    GITHUB_COMMANDS.filter((entry) =>
      entry.isAvailable?.({ threadId, projectId: null, openPanel: () => true }),
    ).map(({ id }) => id);

  it("lists the commands once the composer banner has loaded a ready PR", async () => {
    const slot = renderSlot<object, typeof rpcContract>(
      banner,
      {},
      {
        rpc: { getInsight: () => readyBanner, refresh: () => readyBanner, ...unusedReviewRpc },
        composer: { scope: { kind: "thread", threadId: "thr_banner" } },
      },
    );
    expect(listed("thr_banner")).toEqual([]);

    await slot.findByRole("button", { name: /Ready to merge/ });

    expect(listed("thr_banner")).toContain("merge-pr");
    expect(listed("thr_banner")).toHaveLength(8);
  });

  function renderBannerFor(
    threadId: string,
    getInsight: () => InsightResult | Promise<InsightResult>,
  ) {
    return renderSlot<object, typeof rpcContract>(
      banner,
      {},
      {
        rpc: { getInsight, refresh: getInsight, ...unusedReviewRpc },
        composer: { scope: { kind: "thread", threadId } },
      },
    );
  }

  it("lists the commands once a later load shows a PR", async () => {
    let current: InsightResult = { kind: "no_pr" };
    const slot = renderBannerFor("thr_later_pr", () => current);
    await settle();
    expect(listed("thr_later_pr")).toEqual([]);

    current = readyBanner;
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_later_pr"] });
    await slot.findByRole("button", { name: /Ready to merge/ });

    expect(listed("thr_later_pr")).toHaveLength(8);
  });

  it("ignores a stale load that ends after a newer one", async () => {
    let finishFirst: (result: InsightResult) => void = () => {};
    let loads = 0;
    const slot = renderBannerFor("thr_stale", () =>
      loads++ === 0
        ? new Promise<InsightResult>((resolve) => (finishFirst = resolve))
        : ok(emptyInsight),
    );
    await slot.behavior.emitRealtime("insight.updated", { threadIds: ["thr_stale"] });
    await settle();

    await act(async () => finishFirst(readyBanner));
    await settle();

    expect(listed("thr_stale")).not.toContain("merge-pr");
    expect(listed("thr_stale")).toHaveLength(7);
  });
});

describe("PR tab palette commands", () => {
  it("refreshes with progress, the same as the refresh button", async () => {
    let finish: (result: InsightResult) => void = () => {};
    const slot = renderTab(insight, () => new Promise((resolve) => (finish = resolve)));
    await slot.findByText("#25337");

    await act(async () => postIntent("thr_1", "overview", "refresh"));

    expect(await slot.findByRole("button", { name: "Refreshing…" })).toBeTruthy();
    await act(async () => finish(ok({ ...emptyInsight, pr: { ...pr, state: "merged" } })));
    await slot.findByText("Pull request merged");
  });

  it("opens the PR on GitHub", async () => {
    postIntent("thr_1", "overview", "open-on-github");
    const slot = renderTab(insight);

    await slot.findByText("#25337");

    await vi.waitFor(() =>
      expect(slot.inspection.navigateCalls).toEqual([{ method: "openUrl", url: pr.url }]),
    );
  });

  it("opens no URL for a thread without a PR", async () => {
    postIntent("thr_1", "overview", "open-on-github");
    const slot = renderTab({ kind: "no_pr" });

    await slot.findByText("No pull request for this thread");
    await settle();

    expect(slot.inspection.navigateCalls).toEqual([]);
  });
});
