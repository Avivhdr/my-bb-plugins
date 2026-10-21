// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { NewThreadComposerProps, PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type {
  ActionResult,
  InsightResult,
  LoadedReviewQueue,
  ReviewQueueResult,
  rpcContract,
} from "../contract";
import type { PrInsight } from "../core/overview";
import { buildReviewPrompt } from "../core/review-prompt";
import {
  ok,
  panelRpc,
  queuePr,
  reviewThread,
  view,
  type PanelRpc,
  type QueueHandler,
} from "../test/review-queue-fixtures";
import { isBuiltinIconName } from "../components/ui/icon";
import { OVERVIEW_LAYOUT_KEY } from "./use-overview-layout";
import manifest from "../package.json";

const submitOutcomes: Promise<"cleared" | "kept">[] = [];

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  function DraftKeepingComposer(props: NewThreadComposerProps) {
    const Composer = actual.experimental_NewThreadComposer;
    return (
      <Composer
        {...props}
        onSubmit={(request) => {
          submitOutcomes.push(
            Promise.resolve()
              .then(() => props.onSubmit(request))
              .then(
                () => "cleared" as const,
                () => "kept" as const,
              ),
          );
        }}
      />
    );
  }
  return { ...actual, experimental_NewThreadComposer: DraftKeepingComposer };
});

const app = await loadPluginApp(() => import("../app"));
const panel = app.navPanels.find((registration) => registration.id === "pull-requests")!;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  submitOutcomes.length = 0;
});

function renderPanel(subPath: string, getReviewQueue: QueueHandler, rpc: Partial<PanelRpc> = {}) {
  return renderSlot<PluginNavPanelProps, typeof rpcContract>(
    panel,
    { subPath },
    { rpc: panelRpc(getReviewQueue, rpc) },
  );
}

async function findCard(slot: ReturnType<typeof renderPanel>, listName: string, name: string) {
  const section = await slot.findByRole("region", { name: listName });
  return within(section).getByRole("listitem", { name });
}

function rpcMethods(slot: ReturnType<typeof renderPanel>) {
  return slot.inspection.rpcCalls.map((call) => call.method);
}

describe("Pull Requests panel routes", () => {
  it("registers the Pull Requests nav panel", () => {
    expect(panel).toMatchObject({ title: "Pull Requests", path: "pull-requests" });
  });

  it("uses a bb icon name for the nav panel and the plugin branding, which bb shows in its place", () => {
    expect(isBuiltinIconName(panel.icon)).toBe(true);
    expect(manifest.bb.branding.icon).toBe(panel.icon);
  });

  it("leaves the panel title to the host header", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    await findCard(slot, "Needs review", "acme/api#15");
    expect(slot.queryByRole("heading", { name: "Pull Requests" })).toBeNull();
  });

  it("renders the lists at the panel root", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    expect(await slot.findByRole("region", { name: "Needs review" })).toBeTruthy();
    expect(slot.queryByTestId("bb-new-thread-composer")).toBeNull();
  });

  it("renders the composer for a review subpath", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])));

    expect(await slot.findByTestId("bb-new-thread-composer")).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Needs review" })).toBeNull();
  });

  it("renders the lists for an unknown subpath", async () => {
    const slot = renderPanel("review/acme/api/not-a-number", () => ok(view([queuePr()])));

    expect(await slot.findByRole("region", { name: "Needs review" })).toBeTruthy();
  });
});

describe("Pull Requests lists", () => {
  it("shows the number of review requests in the list header", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ number: 12 }), queuePr({ repo: "acme/web", number: 3 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).getByTestId("queue-count").textContent).toBe("3");
  });

  it("shows the repo groups in server order", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ repo: "acme/web", number: 3 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(
      within(reviews)
        .getAllByTestId("queue-group")
        .map((heading) => heading.textContent),
    ).toEqual(["acme/api", "acme/web"]);
  });

  it("shows the number, title, author, and age on a card", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByRole("heading").textContent).toBe("#15 Add rate limits");
    expect(within(card).getByText("alice")).toBeTruthy();
    expect(within(card).getByText("2 hours ago")).toBeTruthy();
    expect(within(card).queryByText("Draft")).toBeNull();
  });

  it("shows the repository on the group header and not on each card", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ number: 12 }), queuePr({ number: 9 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).getAllByText("acme/api")).toHaveLength(1);
    expect(within(reviews).getByTestId("queue-group").textContent).toBe("acme/api");
  });

  it("shows the time since the last update, not since creation", async () => {
    const slot = renderPanel("", () =>
      ok(
        view([
          queuePr({
            createdAt: new Date(Date.now() - 150 * 86_400_000).toISOString(),
            updatedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
          }),
        ]),
      ),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByText("2 days ago")).toBeTruthy();
  });

  it("leads each row with the CI mark and keeps author, age, review decision, and Draft in one meta row", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ draft: true, reviewDecision: "APPROVED" })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(card.firstElementChild?.getAttribute("data-testid")).toBe("queue-ci");
    const meta = within(card).getByTestId("queue-meta");
    expect(within(meta).getByText("alice")).toBeTruthy();
    expect(within(meta).getByText("now")).toBeTruthy();
    expect(within(meta).getByTestId("queue-review-decision")).toBeTruthy();
    expect(within(meta).getByText("Draft")).toBeTruthy();
    expect(within(meta).queryByRole("button")).toBeNull();
    expect(within(card).getByRole("button", { name: "Start review" })).toBeTruthy();
    expect(within(card).getByRole("button", { name: "Show overview" })).toBeTruthy();
  });

  it("shows Draft on a draft card", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ draft: true, ci: "failed" })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByText("Draft")).toBeTruthy();
    expect(within(card).getByTestId("queue-ci").getAttribute("aria-label")).toBe("CI failed");
  });

  it.each([
    ["merged", "Merged"],
    ["closed", "Closed"],
  ] as const)("shows a %s PR with its state label instead of Draft", async (state, text) => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ state, closedAt: new Date().toISOString(), draft: true })])),
    );

    const meta = within(await findCard(slot, "Needs review", "acme/api#15")).getByTestId(
      "queue-meta",
    );
    expect(within(meta).getByText(text)).toBeTruthy();
    expect(within(meta).queryByText("Draft")).toBeNull();
  });

  it("shows no state label on an open PR", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).queryByText("Merged")).toBeNull();
    expect(within(card).queryByText("Closed")).toBeNull();
  });

  it.each([
    ["passed", "CI passed"],
    ["failed", "CI failed"],
    ["running", "CI running"],
    ["none", "No checks"],
  ] as const)("shows CI state %s", async (ci, text) => {
    const slot = renderPanel("", () => ok(view([queuePr({ ci })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByTestId("queue-ci").getAttribute("aria-label")).toBe(text);
  });

  it.each([
    ["APPROVED", "Approved"],
    ["CHANGES_REQUESTED", "Changes requested"],
  ] as const)("shows review decision %s", async (reviewDecision, text) => {
    const slot = renderPanel("", () => ok(view([queuePr({ reviewDecision })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByTestId("queue-review-decision").textContent).toBe(text);
  });

  it.each([null, "REVIEW_REQUIRED"] as const)(
    "shows no review decision when GitHub reports %s",
    async (reviewDecision) => {
      const slot = renderPanel("", () => ok(view([queuePr({ reviewDecision })])));

      const card = await findCard(slot, "Needs review", "acme/api#15");
      expect(within(card).queryByTestId("queue-review-decision")).toBeNull();
      expect(within(card).queryByText("Review required")).toBeNull();
    },
  );

  it("says when a list holds only the first 50 PRs", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()], true)));

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).getByText("Showing first 50")).toBeTruthy();
  });

  it("says when a list is empty", async () => {
    const slot = renderPanel("", () => ok(view([])));

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).getByText("Nothing to review")).toBeTruthy();
    expect(within(reviews).getByTestId("queue-count").textContent).toBe("0");
  });

  it("keeps the old lists visible during a manual refresh", async () => {
    let finish: (result: LoadedReviewQueue) => void = () => {};
    const slot = renderPanel("", () => ok(view([queuePr()])), {
      refreshReviewQueue: () => new Promise((resolve) => (finish = resolve)),
    });

    await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await slot.findByRole("button", { name: "Refreshing…" });
    expect(slot.getByText("Add rate limits")).toBeTruthy();
    await act(async () => finish(ok(view([queuePr({ title: "Add rate limits v2" })]))));
    await slot.findByText("Add rate limits v2");
    expect(rpcMethods(slot)).toEqual(["getReviewQueue", "refreshReviewQueue"]);
  });
});

describe("Pull Requests card actions", () => {
  it("offers Start review on a review request with a project", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Start review" }));

    expect(within(card).queryByRole("button", { name: /^Open thread/ })).toBeNull();
    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "pull-requests",
        options: { subPath: "review/acme/api/15" },
      },
    ]);
  });

  it("shows the no project hint once on the group header and no Start review on its cards", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ projectIds: [] }), queuePr({ number: 12, projectIds: [] })])),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).getAllByText("No bb project for this repository")).toHaveLength(1);
    for (const name of ["acme/api#15", "acme/api#12"]) {
      const card = within(reviews).getByRole("listitem", { name });
      expect(within(card).queryByText("No bb project for this repository")).toBeNull();
      expect(within(card).queryByRole("button", { name: "Start review" })).toBeNull();
      expect(within(card).getByRole("button", { name: "Show overview" })).toBeTruthy();
    }
  });

  it("shows no project hint on a group that has a project", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ repo: "acme/web", number: 3, projectIds: [] })])),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).getAllByText("No bb project for this repository")).toHaveLength(1);
    expect(
      within(await findCard(slot, "Needs review", "acme/api#15")).getByRole("button", {
        name: "Start review",
      }),
    ).toBeTruthy();
  });

  it("offers Open thread on a review request with a linked thread", async () => {
    const slot = renderPanel("", () =>
      ok(
        view([
          queuePr({
            thread: { id: "thr_linked", status: "idle", isReviewThread: false, returned: null },
          }),
        ]),
      ),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).queryByRole("button", { name: "Start review" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /^Open thread/ }));

    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_linked" }]);
  });
});

describe("PR overview side panel", () => {
  const prInsight = (overrides: Partial<PrInsight> = {}): InsightResult => ({
    kind: "ok",
    refreshedAt: Date.now(),
    error: null,
    insight: {
      pr: {
        number: 15,
        title: "Add rate limits",
        state: "open",
        url: "https://github.com/acme/api/pull/15",
        headOid: "head-15",
        headRefName: "rate-limits",
        headOwner: null,
        isCrossRepository: false,
        baseRefName: "main",
        author: "alice",
        additions: 12,
        deletions: 3,
        changedFiles: 2,
      },
      mergeAction: { kind: "none" },
      mergeQueue: null,
      autoMergeAction: { kind: "none" },
      canUpdateBranch: false,
      blockers: [],
      reviewers: [],
      checks: [],
      ...overrides,
    },
  });

  function overview(slot: ReturnType<typeof renderPanel>) {
    return slot.findByRole("complementary", { name: "Pull request overview" });
  }

  function prInsightCalls(slot: ReturnType<typeof renderPanel>) {
    return slot.inspection.rpcCalls.filter(
      (call) => call.method === "getPrInsight" || call.method === "refreshPrInsight",
    );
  }

  it.each([
    ["without a thread", queuePr({ projectIds: [] })],
    ["with a thread", queuePr({ thread: reviewThread })],
  ])("opens the overview from the GitHub icon of a row %s", async (_, pr) => {
    const slot = renderPanel("", () => ok(view([pr])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Show overview" }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "pr/acme/api/15" } },
    ]);
  });

  it("shows the list and the overview of the selected PR", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getPrInsight: () => prInsight(),
    });

    const panel = await overview(slot);
    expect(await within(panel).findByRole("heading", { name: "Add rate limits" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Open on GitHub" }).getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/15",
    );
    expect(slot.getByRole("region", { name: "Needs review" })).toBeTruthy();
    expect(prInsightCalls(slot).map(({ method, input }) => ({ method, input }))).toEqual([
      { method: "getPrInsight", input: { owner: "acme", repo: "api", number: 15 } },
    ]);
  });

  it("shows blockers, reviewers, and checks without thread actions", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getPrInsight: () =>
        prInsight({
          mergeAction: { kind: "merge", method: "SQUASH" },
          autoMergeAction: { kind: "enable", method: "SQUASH" },
          canUpdateBranch: true,
          blockers: [
            { code: "behind", text: "Branch out of date" },
            { code: "conflicts", text: "Merge conflicts" },
          ],
          reviewers: [{ kind: "user", name: "bob", state: "approved", codeOwner: false }],
          checks: [{ name: "lint", status: "passed", required: true, url: null, failure: null }],
        }),
    });

    const panel = await overview(slot);
    const blockers = await within(panel).findByRole("list", { name: "Merge blockers" });
    expect(within(blockers).getByText("Branch out of date")).toBeTruthy();
    expect(within(blockers).getByRole("link", { name: /Resolve on GitHub/ })).toBeTruthy();
    expect(within(panel).getByRole("list", { name: "Reviewers" }).textContent).toContain("bob");
    expect(within(panel).getByRole("region", { name: "Checks" }).textContent).toContain("1 passed");
    expect(within(panel).getByText(/^Updated/)).toBeTruthy();
    expect(
      within(panel)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["Maximize overview", "Close overview", "Refresh"]);
  });

  it("marks the selected row and closes the overview from its GitHub icon", async () => {
    const slot = renderPanel(
      "pr/acme/api/15",
      () => ok(view([queuePr(), queuePr({ number: 12 })])),
      {
        getPrInsight: () => prInsight(),
      },
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(card.getAttribute("aria-current")).toBe("true");
    const other = await findCard(slot, "Needs review", "acme/api#12");
    expect(other.getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Hide overview" }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "" } },
    ]);
  });

  it("goes back to the plain list on Close overview", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getPrInsight: () => prInsight(),
    });

    fireEvent.click(within(await overview(slot)).getByRole("button", { name: "Close overview" }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "" } },
    ]);
  });

  it("asks the server to read GitHub again on Refresh", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getPrInsight: () => prInsight(),
      refreshPrInsight: () => prInsight({ pr: { ...prTitle("Add rate limits v2") } }),
    });

    const panel = await overview(slot);
    fireEvent.click(await within(panel).findByRole("button", { name: "Refresh" }));

    expect(await within(panel).findByRole("heading", { name: "Add rate limits v2" })).toBeTruthy();
    expect(prInsightCalls(slot).map(({ method }) => method)).toEqual([
      "getPrInsight",
      "refreshPrInsight",
    ]);
  });

  it("keeps the last good overview when a refresh fails", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getPrInsight: () => prInsight(),
      refreshPrInsight: () => ({ kind: "error", message: "gh not logged in" }),
    });

    const panel = await overview(slot);
    fireEvent.click(await within(panel).findByRole("button", { name: "Refresh" }));

    expect((await within(panel).findByRole("alert")).textContent).toContain("gh not logged in");
    expect(within(panel).getByRole("heading", { name: "Add rate limits" })).toBeTruthy();
  });

  it("reloads when the server publishes an update for the PR", async () => {
    let title = "Add rate limits";
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getPrInsight: () => prInsight({ pr: prTitle(title) }),
    });
    const panel = await overview(slot);
    await within(panel).findByRole("heading", { name: "Add rate limits" });

    title = "Add rate limits v2";
    await slot.behavior.emitRealtime("insight.updated", { threadIds: [], prKeys: ["acme/api#14"] });
    expect(prInsightCalls(slot)).toHaveLength(1);
    await slot.behavior.emitRealtime("insight.updated", { threadIds: [], prKeys: ["acme/api#15"] });

    expect(await within(panel).findByRole("heading", { name: "Add rate limits v2" })).toBeTruthy();
  });

  describe("layout", () => {
    beforeEach(() => {
      localStorage.clear();
      Element.prototype.setPointerCapture = vi.fn();
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
        this: HTMLElement,
      ) {
        const width = parseFloat(this.style.getPropertyValue("--overview-width")) || 0;
        return {
          top: 0,
          bottom: 0,
          height: 0,
          left: 0,
          right: width,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).setPointerCapture;
    });

    function renderOverview() {
      return renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
        getPrInsight: () => prInsight(),
      });
    }

    async function handleOf(slot: ReturnType<typeof renderPanel>) {
      const handle = within(await overview(slot)).getByRole("separator", {
        name: "Resize overview",
      });
      return { handle, width: () => Number(handle.getAttribute("aria-valuenow")) };
    }

    function saved() {
      return JSON.parse(localStorage.getItem(OVERVIEW_LAYOUT_KEY) ?? "null");
    }

    it("starts 440px wide", async () => {
      const slot = renderOverview();
      const { width } = await handleOf(slot);

      expect(width()).toBe(440);
      expect((await overview(slot)).style.getPropertyValue("--overview-width")).toBe("440px");
    });

    it("grows 10px per ArrowLeft and shrinks per ArrowRight, and saves the width", async () => {
      const { handle, width } = await handleOf(renderOverview());

      fireEvent.keyDown(handle, { key: "ArrowLeft" });
      expect(width()).toBe(450);

      fireEvent.keyDown(handle, { key: "ArrowRight" });
      fireEvent.keyDown(handle, { key: "ArrowRight" });
      expect(width()).toBe(430);
      expect(saved()).toEqual({ width: 430, maximized: false });
    });

    it("grows when dragged left and saves the width on release", async () => {
      const { handle, width } = await handleOf(renderOverview());

      fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1, button: 0 });
      fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });

      expect(width()).toBe(540);
      expect(saved()).toBeNull();

      fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });

      expect(saved()).toEqual({ width: 540, maximized: false });
    });

    it.each([
      ["left", 0, 960],
      ["right", 1100, 360],
    ])("stops at the bounds when dragged far %s", async (_, to, expected) => {
      const { handle, width } = await handleOf(renderOverview());

      fireEvent.pointerDown(handle, { clientX: 1000, pointerId: 1, button: 0 });
      fireEvent.pointerMove(handle, { clientX: to, pointerId: 1 });
      fireEvent.pointerUp(handle, { clientX: to, pointerId: 1 });

      expect(width()).toBe(expected);
    });

    it("resets to 440px on double-click", async () => {
      localStorage.setItem(OVERVIEW_LAYOUT_KEY, JSON.stringify({ width: 700, maximized: false }));
      const { handle, width } = await handleOf(renderOverview());

      fireEvent.doubleClick(handle);

      expect(width()).toBe(440);
    });

    it("opens with the saved width after a remount", async () => {
      const first = renderOverview();
      fireEvent.keyDown((await handleOf(first)).handle, { key: "ArrowLeft" });
      first.unmount();

      const { width } = await handleOf(renderOverview());

      expect(width()).toBe(450);
    });

    it("hides the list while maximized and shows it again on restore", async () => {
      const slot = renderOverview();
      const panel = await overview(slot);
      await findCard(slot, "Needs review", "acme/api#15");

      fireEvent.click(within(panel).getByRole("button", { name: "Maximize overview" }));

      expect(slot.queryByRole("region", { name: "Needs review" })).toBeNull();
      expect(within(panel).queryByRole("separator")).toBeNull();
      expect(saved()).toEqual({ width: 440, maximized: true });

      fireEvent.click(within(panel).getByRole("button", { name: "Restore overview" }));

      expect(slot.getByRole("region", { name: "Needs review" })).toBeTruthy();
      expect(within(panel).getByRole("separator", { name: "Resize overview" })).toBeTruthy();
    });

    it("reopens maximized after a remount", async () => {
      const first = renderOverview();
      fireEvent.click(
        within(await overview(first)).getByRole("button", { name: "Maximize overview" }),
      );
      first.unmount();

      const slot = renderOverview();

      expect(
        within(await overview(slot)).getByRole("button", { name: "Restore overview" }),
      ).toBeTruthy();
      expect(slot.queryByRole("region", { name: "Needs review" })).toBeNull();
    });
  });

  function prTitle(title: string) {
    const result = prInsight();
    if (result.kind !== "ok") throw new Error("unreachable");
    return { ...result.insight.pr, title };
  }
});

describe("Pull Requests updates", () => {
  it("renders the stored view on mount without a refresh", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    await findCard(slot, "Needs review", "acme/api#15");
    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("shows loading until the first background load is published", async () => {
    const slot = renderPanel("", () => ({ kind: "loading" }));

    expect(await slot.findByText("Loading pull requests…")).toBeTruthy();
    await slot.behavior.emitRealtime("review-queue.updated", ok(view([queuePr()])));

    expect(await findCard(slot, "Needs review", "acme/api#15")).toBeTruthy();
    expect(slot.queryByText("Loading pull requests…")).toBeNull();
  });

  it("shows a published update without a call", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Needs review", "acme/api#15");

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr(), queuePr({ number: 16, title: "Add caching" })])),
    );

    expect(await findCard(slot, "Needs review", "acme/api#16")).toBeTruthy();
    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("ignores a malformed update", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Needs review", "acme/api#15");

    await slot.behavior.emitRealtime("review-queue.updated", { kind: "ok" });

    expect(await findCard(slot, "Needs review", "acme/api#15")).toBeTruthy();
  });

  it("asks the server to refresh on Refresh", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Needs review", "acme/api#15");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await slot.findByRole("button", { name: "Refresh" });
    expect(rpcMethods(slot)).toEqual(["getReviewQueue", "refreshReviewQueue"]);
  });

  it("makes no calls of its own while open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Needs review", "acme/api#15");

    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));

    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("puts Refresh and the update time on the Needs review header row", async () => {
    const slot = renderPanel("", () =>
      ok({ ...view([queuePr()]), loadedAt: Date.now() - 3 * 60_000 }),
    );

    const section = await slot.findByRole("region", { name: "Needs review" });
    const headerRow = within(section).getByRole("heading", { name: /Needs review/ }).parentElement!;
    expect(within(headerRow).getByRole("button", { name: "Refresh" })).toBeTruthy();
    expect(headerRow.textContent).toContain("Updated 3 minutes ago");
    expect(slot.getAllByRole("button", { name: "Refresh" })).toHaveLength(1);
  });
});

describe("Pull Requests errors", () => {
  const notLoggedIn: ReviewQueueResult = {
    kind: "error",
    message: "gh not logged in",
    lastGood: null,
  };

  it("shows the reason and a retry action without earlier data", async () => {
    let result: ReviewQueueResult = notLoggedIn;
    const slot = renderPanel("", () => result);

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("gh not logged in")).toBeTruthy();
    expect(within(alert).queryByText(/last updated/i)).toBeNull();
    expect(slot.queryByRole("region", { name: "Needs review" })).toBeNull();

    result = ok(view([queuePr()]));
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    await findCard(slot, "Needs review", "acme/api#15");
    expect(slot.queryByRole("alert")).toBeNull();
  });

  it("keeps the last good lists with their load time", async () => {
    const slot = renderPanel("", () => ({ ...notLoggedIn, lastGood: view([queuePr()]) }));

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("gh not logged in")).toBeTruthy();
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(
      within(alert)
        .getByText(/last updated/i)
        .querySelector("time")?.dateTime,
    ).toBe("2026-10-02T09:30:00.000Z");
    expect(await findCard(slot, "Needs review", "acme/api#15")).toBeTruthy();
  });

  it("keeps the lists of an earlier load when a refresh fails", async () => {
    let result: ReviewQueueResult = ok(view([queuePr()]));
    const slot = renderPanel("", () => result);
    await findCard(slot, "Needs review", "acme/api#15");

    result = notLoggedIn;
    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("gh not logged in")).toBeTruthy();
    expect(within(alert).getByText(/last updated/i)).toBeTruthy();
    expect(slot.getByText("Add rate limits")).toBeTruthy();
  });

  it("shows the message of a rejected call", async () => {
    const slot = renderPanel("", () => {
      throw new Error("No host available");
    });

    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("No host available")).toBeTruthy();
  });
});

describe("Review composer", () => {
  it("seeds the composer with the project, a new worktree, the prompt, and a draft key", async () => {
    const pr = queuePr();
    const slot = renderPanel("review/acme/api/15", () => ok(view([pr])));

    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.dataset.defaultProjectId).toBe("prj_api");
    expect(JSON.parse(composer.dataset.defaultEnvironment!)).toEqual({
      type: "host",
      hostId: "host-1",
      workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
    });
    expect(composer.dataset.draftKey).toBe("github-insight:review:acme/api#15");
    expect(
      (within(composer).getByTestId("bb-new-thread-composer-input") as HTMLTextAreaElement).value,
    ).toBe(buildReviewPrompt(pr));
  });

  it("seeds no environment without a primary host", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])), {
      getPrimaryHost: () => ({ hostId: null }),
    });

    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.dataset.defaultEnvironment).toBeFalsy();
  });

  it("seeds no environment when the host lookup fails", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])), {
      getPrimaryHost: () => {
        throw new Error("no config");
      },
    });

    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.dataset.defaultEnvironment).toBeFalsy();
  });

  it("goes back to the lists without starting a thread", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])));

    await slot.findByTestId("bb-new-thread-composer");
    fireEvent.click(slot.getByRole("button", { name: "Back" }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "" } },
    ]);
    expect(rpcMethods(slot)).not.toContain("startReview");
  });

  it("starts the review and opens the new thread", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])));

    fireEvent.click(await slot.findByTestId("bb-new-thread-composer-submit"));

    expect(await submitOutcomes[0]).toBe("cleared");
    const start = slot.inspection.rpcCalls.find((call) => call.method === "startReview");
    expect(start?.input).toMatchObject({
      pr: {
        repo: "acme/api",
        number: 15,
        title: "Add rate limits",
        url: "https://github.com/acme/api/pull/15",
      },
      request: {
        projectId: "prj_api",
        environment: { type: "host", workspace: { type: "managed-worktree" } },
        input: [{ type: "text", text: buildReviewPrompt(queuePr()) }],
      },
    });
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_new" }]);
  });

  it("keeps the draft and shows the error when the start fails", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])), {
      startReview: () => {
        throw new Error("spawn failed");
      },
    });

    fireEvent.click(await slot.findByTestId("bb-new-thread-composer-submit"));

    expect(await submitOutcomes[0]).toBe("kept");
    const alert = await slot.findByRole("alert");
    expect(within(alert).getByText("spawn failed")).toBeTruthy();
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("keeps the first project when an update changes the project order", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])));
    expect((await slot.findByTestId("bb-new-thread-composer")).dataset.defaultProjectId).toBe(
      "prj_api",
    );

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr({ projectIds: ["prj_api_new", "prj_api"] })])),
    );

    expect(slot.getByTestId("bb-new-thread-composer").dataset.defaultProjectId).toBe("prj_api");
  });

  it("keeps the composer when an update drops the PR", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])));
    const composer = await slot.findByTestId("bb-new-thread-composer");

    await slot.behavior.emitRealtime("review-queue.updated", ok(view([])));

    expect(slot.getByTestId("bb-new-thread-composer")).toBe(composer);
    expect(slot.queryByText("This pull request is not in your review requests")).toBeNull();
  });

  it("seeds the composer from the new PR when the route changes", async () => {
    const other = queuePr({ number: 16, title: "Add caching" });
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr(), other])));
    await slot.findByTestId("bb-new-thread-composer");

    const Panel = panel.component;
    slot.lifecycle.rerender(<Panel subPath="review/acme/api/16" />);

    const composer = await slot.findByTestId("bb-new-thread-composer");
    expect(composer.dataset.draftKey).toBe("github-insight:review:acme/api#16");
    expect(
      (within(composer).getByTestId("bb-new-thread-composer-input") as HTMLTextAreaElement).value,
    ).toBe(buildReviewPrompt(other));
  });

  it("finds the PR when the subpath repo differs in case", async () => {
    const slot = renderPanel("review/Acme/API/15", () => ok(view([queuePr()])));

    expect(await slot.findByTestId("bb-new-thread-composer")).toBeTruthy();
  });

  it("says so when the PR is not in the review requests", async () => {
    const slot = renderPanel("review/acme/api/99", () => ok(view([queuePr()])));

    expect(await slot.findByText("This pull request is not in your review requests")).toBeTruthy();
    expect(slot.queryByTestId("bb-new-thread-composer")).toBeNull();
  });
});

describe("Reviewed section", () => {
  it("shows Needs review above Reviewed", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    await findCard(slot, "Needs review", "acme/api#15");
    expect(slot.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "Needs review",
      "Reviewed",
    ]);
  });

  it("starts collapsed with its count and expands", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ review: "reviewed" }), queuePr({ number: 12, review: "reviewed" })])),
    );

    const reviewed = await slot.findByRole("region", { name: "Reviewed" });
    const toggle = within(reviewed).getByRole("button", { name: /Reviewed/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(reviewed).getByTestId("queue-count").textContent).toBe("2");
    expect(within(reviewed).queryByRole("listitem")).toBeNull();

    fireEvent.click(toggle);

    expect(within(reviewed).getByRole("listitem", { name: "acme/api#15" })).toBeTruthy();
  });

  it("labels a PR that got a new commit after the review", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ review: "updated_since_review" })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByText("New commits")).toBeTruthy();
  });

  it("shows no updated label on a PR that was never reviewed", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).queryByText("New commits")).toBeNull();
  });

  it.each([
    ["new_comments", "New comments"],
    ["requested_again", "Review requested again"],
  ] as const)("labels a marked PR with %s activity as %s", async (activity, label) => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ review: "reviewed", newActivity: [activity] })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByText(label)).toBeTruthy();
  });

  it("shows a push, comments, and a new request together", async () => {
    const slot = renderPanel("", () =>
      ok(
        view([
          queuePr({
            review: "updated_since_review",
            newActivity: ["new_comments", "requested_again"],
          }),
        ]),
      ),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByText("New commits")).toBeTruthy();
    expect(within(card).getByText("New comments")).toBeTruthy();
    expect(within(card).getByText("Review requested again")).toBeTruthy();
  });

  it("offers Mark reviewed on a marked PR that came back with new activity", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ review: "reviewed", newActivity: ["new_comments"] })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByRole("button", { name: "Mark reviewed" })).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Mark as needs review" })).toBeNull();
  });

  it("shows no activity label on a PR without new activity", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).queryByText("New comments")).toBeNull();
    expect(within(card).queryByText("Review requested again")).toBeNull();
  });
});

describe("Mark actions", () => {
  async function expandReviewed(slot: ReturnType<typeof renderPanel>) {
    const reviewed = await slot.findByRole("region", { name: "Reviewed" });
    fireEvent.click(within(reviewed).getByRole("button", { name: /Reviewed/ }));
    return reviewed;
  }

  it("sends the head shown on the card and disables the action until the server answers", async () => {
    let answer: (result: ActionResult) => void = () => {};
    const slot = renderPanel("", () => ok(view([queuePr()])), {
      markReviewed: () => new Promise((resolve) => (answer = resolve)),
    });

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Mark reviewed" }));

    await vi.waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "Mark reviewed" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    const call = slot.inspection.rpcCalls.find((candidate) => candidate.method === "markReviewed");
    expect(call?.input).toEqual({ repo: "acme/api", number: 15, headOid: "head-15" });
    await act(async () => answer({ kind: "ok" }));
    expect(
      within(card).getByRole("button", { name: "Mark reviewed" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("moves the PR to Reviewed when the server publishes the mark", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Needs review", "acme/api#15");

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr({ review: "reviewed" })])),
    );

    const reviewed = await expandReviewed(slot);
    expect(within(reviewed).getByRole("listitem", { name: "acme/api#15" })).toBeTruthy();
    expect(
      within(slot.getByRole("region", { name: "Needs review" })).getByText("Nothing to review"),
    ).toBeTruthy();
  });

  it("keeps the PR and shows the error when the mark fails", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])), {
      markReviewed: () => ({ kind: "error", message: "disk full" }),
    });

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Mark reviewed" }));

    expect(within(await slot.findByRole("alert")).getByText("disk full")).toBeTruthy();
    expect(await findCard(slot, "Needs review", "acme/api#15")).toBeTruthy();
  });

  it("asks the server to mark a reviewed PR as needs review", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ review: "reviewed" })])));

    const reviewed = await expandReviewed(slot);
    const card = within(reviewed).getByRole("listitem", { name: "acme/api#15" });
    fireEvent.click(within(card).getByRole("button", { name: "Mark as needs review" }));

    await vi.waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((candidate) => candidate.method === "markNeedsReview")?.input,
      ).toEqual({
        repo: "acme/api",
        number: 15,
      }),
    );
  });
});

describe("Thread on the PR row", () => {
  it.each([
    ["running", "Running"],
    ["needs_you", "Needs you"],
    ["idle", "Waiting"],
    ["error", "Failed"],
  ] as const)("shows thread status %s", async (status, text) => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ thread: { ...reviewThread, status } })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByTestId("review-status").textContent).toBe(text);
  });

  it("names the thread button by its action and its status", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    const button = within(card).getByRole("button", { name: "Open thread: Running" });
    expect(within(button).getByTestId("review-status")).toBeTruthy();
    expect(within(within(card).getByTestId("queue-meta")).queryByText("Running")).toBeNull();
  });

  it("opens the thread from the row", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: /^Open thread/ }));

    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_review" }]);
  });

  it.each([
    [
      "a branch thread",
      { id: "thr_branch", status: "idle", isReviewThread: false, returned: null },
    ],
    ["no thread", null],
  ] as const)("keeps Archive thread in place but disabled for %s", async (_, thread) => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    const archive = within(card).getByRole("button", { name: "Archive thread" });
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(archive);
    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("explains why Archive thread is disabled", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.pointerMove(within(card).getByRole("button", { name: "Archive thread" }), {
      pointerType: "mouse",
    });

    expect((await slot.findByRole("tooltip")).textContent).toBe(
      "Only review threads can be archived",
    );
  });

  it("enables Archive thread for a review thread", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(
      within(card).getByRole("button", { name: "Archive thread" }).getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("archives the review thread and offers Start review again without a refresh", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Archive thread" }));

    expect(await within(card).findByRole("button", { name: "Start review" })).toBeTruthy();
    expect(within(card).queryByTestId("review-status")).toBeNull();
    const archive = slot.inspection.rpcCalls.find((call) => call.method === "archiveReview");
    expect(archive?.input).toEqual({ threadId: "thr_review" });
    expect(rpcMethods(slot)).toEqual(["getReviewQueue", "archiveReview"]);
  });

  it("keeps the thread and shows the reason when the archive is refused", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])), {
      archiveReview: () => ({ kind: "error", message: "This thread is not a review thread" }),
    });

    const card = await findCard(slot, "Needs review", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Archive thread" }));

    expect(
      within(await slot.findByRole("alert")).getByText("This thread is not a review thread"),
    ).toBeTruthy();
    expect(within(card).getByRole("button", { name: /^Open thread/ })).toBeTruthy();
  });
});

describe("returned review threads on cards", () => {
  it.each([
    ["idle", "finished", "Ready"],
    ["needs_you", "needs_you", "Needs you"],
    ["error", "failed", "Failed"],
  ] as const)("shows a %s thread that came back as %s", async (status, returned, text) => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ thread: { ...reviewThread, status, returned } })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByTestId("review-status").textContent).toBe(text);
  });

  it("shows an opened idle thread with the plain status", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ thread: { ...reviewThread, status: "idle" } })])),
    );

    const card = await findCard(slot, "Needs review", "acme/api#15");
    expect(within(card).getByTestId("review-status").textContent).toBe("Waiting");
  });
});

describe("agent status filter", () => {
  const running = { ...reviewThread, status: "running" } as const;
  const needsYou = { ...reviewThread, status: "needs_you" } as const;
  const idle = { ...reviewThread, status: "idle" } as const;

  function agentQueue() {
    return ok(
      view([
        queuePr({ number: 1, thread: running }),
        queuePr({ number: 2, thread: running }),
        queuePr({ repo: "acme/web", number: 3, thread: needsYou }),
        queuePr({ number: 4, thread: idle }),
        queuePr({ repo: "acme/web", number: 5 }),
      ]),
    );
  }

  function visibleCards(reviews: HTMLElement) {
    return within(reviews)
      .getAllByRole("listitem")
      .map((card) => card.getAttribute("aria-label"));
  }

  it("counts active agent states in the Needs review header and skips idle threads", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    const filter = within(reviews).getByRole("group", { name: "Filter by agent status" });
    expect(
      within(filter)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Running 2", "Needs you 1"]);
  });

  it("counts returned and errored threads under the same labels their rows show", async () => {
    const slot = renderPanel("", () =>
      ok(
        view([
          queuePr({ number: 1, thread: { ...reviewThread, status: "idle", returned: "finished" } }),
          queuePr({ number: 2, thread: { ...reviewThread, status: "error" } }),
          queuePr({ number: 3, thread: { ...reviewThread, status: "idle", returned: "failed" } }),
        ]),
      ),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    fireEvent.click(within(reviews).getByRole("button", { name: "Failed 2" }));
    expect(
      within(reviews)
        .getAllByTestId("review-status")
        .map((status) => status.textContent),
    ).toEqual(["Failed", "Failed"]);
    expect(within(reviews).getByRole("button", { name: "Ready 1" })).toBeTruthy();
  });

  it("hides the filter and shows Nothing to review when the list empties under a filter", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    fireEvent.click(within(reviews).getByRole("button", { name: "Running 2" }));
    await slot.behavior.emitRealtime("review-queue.updated", ok(view([])));

    await within(reviews).findByText("Nothing to review");
    expect(within(reviews).queryByRole("group", { name: "Filter by agent status" })).toBeNull();
  });

  it("shows no filter when no agent is active", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ thread: idle }), queuePr({ number: 2 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    expect(within(reviews).queryByRole("group", { name: "Filter by agent status" })).toBeNull();
  });

  it("shows only the rows in the chosen state and keeps the total count", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    const runningFilter = within(reviews).getByRole("button", { name: "Running 2" });
    fireEvent.click(runningFilter);

    expect(runningFilter.getAttribute("aria-pressed")).toBe("true");
    expect(visibleCards(reviews)).toEqual(["acme/api#1", "acme/api#2"]);
    expect(
      within(reviews)
        .getAllByTestId("queue-group")
        .map((group) => group.textContent),
    ).toEqual(["acme/api"]);
    expect(within(reviews).getByTestId("queue-count").textContent).toBe("5");
  });

  it("shows every row again when the chosen state is pressed a second time", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    const needsYouFilter = within(reviews).getByRole("button", { name: "Needs you 1" });
    fireEvent.click(needsYouFilter);
    expect(visibleCards(reviews)).toEqual(["acme/web#3"]);

    fireEvent.click(needsYouFilter);
    expect(needsYouFilter.getAttribute("aria-pressed")).toBe("false");
    expect(visibleCards(reviews)).toHaveLength(5);
  });

  it("keeps the chosen filter and offers to clear it when its last agent stops", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Needs review" });
    fireEvent.click(within(reviews).getByRole("button", { name: "Needs you 1" }));
    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr({ number: 1, thread: running }), queuePr({ number: 3, thread: idle })])),
    );

    await within(reviews).findByText("No pull requests match this filter");
    expect(within(reviews).getByRole("button", { name: "Needs you 0" })).toBeTruthy();
    fireEvent.click(within(reviews).getByRole("button", { name: "Show all" }));
    expect(visibleCards(reviews)).toEqual(["acme/api#1", "acme/api#3"]);
  });
});

describe("marking PRs seen", () => {
  function seenCalls(slot: ReturnType<typeof renderPanel>) {
    return slot.inspection.rpcCalls
      .filter((call) => call.method === "markQueueSeen")
      .map((call) => call.input);
  }

  it("marks the shown needs-review PRs seen when the panel opens with unseen PRs", async () => {
    const slot = renderPanel("", () =>
      ok({
        ...view([queuePr(), queuePr({ number: 12, review: "reviewed" })]),
        hasUnseen: true,
      }),
    );

    await vi.waitFor(() =>
      expect(seenCalls(slot)).toEqual([{ prs: [{ repo: "acme/api", number: 15 }] }]),
    );
  });

  it("marks a PR seen that arrives while the panel is open", async () => {
    const slot = renderPanel("", () => ok({ ...view([queuePr()]), hasUnseen: true }));
    await vi.waitFor(() => expect(seenCalls(slot)).toHaveLength(1));

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok({ ...view([queuePr(), queuePr({ number: 16 })]), hasUnseen: true }),
    );

    await vi.waitFor(() =>
      expect(seenCalls(slot).at(-1)).toEqual({
        prs: [
          { repo: "acme/api", number: 15 },
          { repo: "acme/api", number: 16 },
        ],
      }),
    );
  });

  it("writes nothing when every PR was seen", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    await findCard(slot, "Needs review", "acme/api#15");
    expect(seenCalls(slot)).toEqual([]);
  });
});

describe("Row control tooltips", () => {
  function hover(element: HTMLElement) {
    fireEvent.pointerMove(element, { pointerType: "mouse" });
  }

  function focusWithKeyboard(element: HTMLElement) {
    fireEvent.keyDown(document, { key: "Tab" });
    act(() => element.focus());
  }

  it("shows Mark reviewed on hover over the check icon", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    hover(within(card).getByRole("button", { name: "Mark reviewed" }));

    expect((await slot.findByRole("tooltip")).textContent).toBe("Mark reviewed");
  });

  it("shows Mark as needs review on hover over the undo icon", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ review: "reviewed" })])));

    const reviewed = await slot.findByRole("region", { name: "Reviewed" });
    fireEvent.click(within(reviewed).getByRole("button", { name: /Reviewed/ }));
    const card = within(reviewed).getByRole("listitem", { name: "acme/api#15" });
    hover(within(card).getByRole("button", { name: "Mark as needs review" }));

    expect((await slot.findByRole("tooltip")).textContent).toBe("Mark as needs review");
  });

  it("shows Show overview on keyboard focus", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    focusWithKeyboard(within(card).getByRole("button", { name: "Show overview" }));

    expect((await slot.findByRole("tooltip")).textContent).toBe("Show overview");
  });

  it("shows the CI state on hover over the CI icon", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ ci: "failed" })])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    hover(within(card).getByRole("img", { name: "CI failed" }));

    expect((await slot.findByRole("tooltip")).textContent).toBe("CI failed");
  });

  it.each([
    [/^Open thread/, queuePr({ thread: reviewThread })],
    ["Start review", queuePr()],
  ])("shows no tooltip on %s", async (name, pr) => {
    const slot = renderPanel("", () => ok(view([pr])));

    const card = await findCard(slot, "Needs review", "acme/api#15");
    const button = within(card).getByRole("button", { name });
    hover(button);
    focusWithKeyboard(button);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(slot.queryByRole("tooltip")).toBeNull();
  });
});
