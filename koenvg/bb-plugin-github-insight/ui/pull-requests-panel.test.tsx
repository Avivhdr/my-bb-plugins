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
import {
  buildReviewPrompt,
  DEFAULT_RE_REVIEW_INSTRUCTIONS,
  DEFAULT_REVIEW_INSTRUCTIONS,
  reviewPromptHead,
} from "../core/review-prompt";
import {
  activityItem,
  activityOk,
  activityPr,
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

function openActions(card: HTMLElement) {
  fireEvent.keyDown(within(card).getByRole("button", { name: "More actions" }), { key: "Enter" });
}

async function chooseAction(slot: ReturnType<typeof renderPanel>, card: HTMLElement, name: string) {
  openActions(card);
  fireEvent.click(await slot.findByRole("menuitem", { name }));
}

/** The RPC calls, without the read of the Activity tab badge. */
function rpcMethods(slot: ReturnType<typeof renderPanel>) {
  return slot.inspection.rpcCalls
    .map((call) => call.method)
    .filter((method) => method !== "getActivity");
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

    await findCard(slot, "Direct", "acme/api#15");
    expect(slot.queryByRole("heading", { name: "Pull Requests" })).toBeNull();
  });

  it("renders the lists at the panel root", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    expect(await slot.findByRole("region", { name: "Direct" })).toBeTruthy();
    expect(slot.queryByTestId("bb-new-thread-composer")).toBeNull();
  });

  it("renders the composer for a review subpath", async () => {
    const slot = renderPanel("review/acme/api/15", () => ok(view([queuePr()])));

    expect(await slot.findByTestId("bb-new-thread-composer")).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Direct" })).toBeNull();
  });

  it("renders the lists for an unknown subpath", async () => {
    const slot = renderPanel("review/acme/api/not-a-number", () => ok(view([queuePr()])));

    expect(await slot.findByRole("region", { name: "Direct" })).toBeTruthy();
  });
});

describe("Pull Requests lists", () => {
  it("shows the number of review requests in the list header", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ number: 12 }), queuePr({ repo: "acme/web", number: 3 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Direct" });
    expect(within(reviews).getByTestId("queue-count").textContent).toBe("3");
  });

  it("shows the repo groups in server order", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ repo: "acme/web", number: 3 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Direct" });
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

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByTitle("Add rate limits").textContent).toBe("#15 Add rate limits");
    expect(within(card).getByRole("img", { name: "alice" }).getAttribute("title")).toBe("alice");
    expect(within(card).queryByText("alice")).toBeNull();
    expect(within(card).getByText("2 hours ago")).toBeTruthy();
    expect(within(card).queryByText("Draft")).toBeNull();
  });

  it("shows the repository on the group header and not on each card", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ number: 12 }), queuePr({ number: 9 })])),
    );

    const reviews = await slot.findByRole("region", { name: "Direct" });
    expect(within(reviews).getAllByText("acme/api")).toHaveLength(1);
    expect(within(reviews).getByTestId("queue-group").textContent).toBe("acme/api");
  });

  it("shows the author's GitHub avatar instead of the name", async () => {
    const url = "https://avatars.githubusercontent.com/u/1?s=40";
    const slot = renderPanel("", () => ok(view([queuePr({ authorAvatarUrl: url })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    const avatar = within(card).getByRole("img", { name: "alice" });
    expect(avatar.tagName).toBe("IMG");
    expect(avatar.getAttribute("src")).toBe(url);
  });

  it("shows the time since the PR was opened, not since its last update", async () => {
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

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByText("5 months ago")).toBeTruthy();
  });

  it("leads each row with the CI mark and keeps author, age, review decision, and Draft in one meta row", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ draft: true, reviewDecision: "APPROVED" })])),
    );

    const card = await findCard(slot, "Direct", "acme/api#15");
    const row = within(card).getByRole("button", { name: /Show overview/ });
    expect(row.firstElementChild?.getAttribute("data-testid")).toBe("queue-ci");
    const meta = within(card).getByTestId("queue-meta");
    expect(within(meta).getByRole("img", { name: "alice" })).toBeTruthy();
    expect(within(meta).getByText("2 hours ago")).toBeTruthy();
    expect(within(meta).getByTestId("queue-review-decision")).toBeTruthy();
    expect(within(meta).getByText("Draft")).toBeTruthy();
    expect(within(meta).queryByRole("button")).toBeNull();
    expect(within(card).getByRole("button", { name: "Start review" })).toBeTruthy();
  });

  it("shows Draft on a draft card", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ draft: true, ci: "failed" })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
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

    const merged = await slot.findByRole("region", { name: "Merged" });
    fireEvent.click(within(merged).getByRole("button", { expanded: false }));
    const meta = within(await findCard(slot, "Merged", "acme/api#15")).getByTestId("queue-meta");
    expect(within(meta).getByText(text)).toBeTruthy();
    expect(within(meta).queryByText("Draft")).toBeNull();
  });

  it("shows no state label on an open PR", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Direct", "acme/api#15");
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

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByTestId("queue-ci").getAttribute("aria-label")).toBe(text);
  });

  it.each([
    ["APPROVED", "Approved"],
    ["CHANGES_REQUESTED", "Changes requested"],
  ] as const)("shows review decision %s", async (reviewDecision, text) => {
    const slot = renderPanel("", () => ok(view([queuePr({ reviewDecision })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByTestId("queue-review-decision").textContent).toBe(text);
  });

  it.each([null, "REVIEW_REQUIRED"] as const)(
    "shows no review decision when GitHub reports %s",
    async (reviewDecision) => {
      const slot = renderPanel("", () => ok(view([queuePr({ reviewDecision })])));

      const card = await findCard(slot, "Direct", "acme/api#15");
      expect(within(card).queryByTestId("queue-review-decision")).toBeNull();
      expect(within(card).queryByText("Review required")).toBeNull();
    },
  );

  it("says when a list holds only the first 50 PRs", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()], true)));

    const reviews = await slot.findByRole("region", { name: "Direct" });
    expect(within(reviews).getByText("Showing first 50")).toBeTruthy();
  });

  it("leaves out empty layers and says when nothing waits", async () => {
    const slot = renderPanel("", () => ok({ ...view([]), teammatesTeam: "acme/core" }));

    expect(await slot.findByText("Nothing to review")).toBeTruthy();
    expect(slot.queryByRole("region")).toBeNull();
  });

  it("leaves out an empty layer next to one with PRs", async () => {
    const slot = renderPanel("", () =>
      ok({ ...view([queuePr({ layer: "Team" })]), teammatesTeam: "acme/core" }),
    );

    await slot.findByRole("region", { name: "Team" });
    expect(slot.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "Team",
    ]);
    expect(slot.queryByText("Nothing to review")).toBeNull();
  });

  it("keeps the old lists visible during a manual refresh", async () => {
    let finish: (result: LoadedReviewQueue) => void = () => {};
    const slot = renderPanel("", () => ok(view([queuePr()])), {
      refreshReviewQueue: () => new Promise((resolve) => (finish = resolve)),
    });

    await findCard(slot, "Direct", "acme/api#15");
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

    const card = await findCard(slot, "Direct", "acme/api#15");
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

  it("shows Queued in place of Start review for a PR auto-review will start, and still opens the composer", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ autoQueued: true })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).queryByRole("button", { name: "Start review" })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Queued" }));

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

    const reviews = await slot.findByRole("region", { name: "Direct" });
    expect(within(reviews).getAllByText("No bb project for this repository")).toHaveLength(1);
    for (const name of ["acme/api#15", "acme/api#12"]) {
      const card = within(reviews).getByRole("listitem", { name });
      expect(within(card).queryByText("No bb project for this repository")).toBeNull();
      expect(within(card).queryByRole("button", { name: "Start review" })).toBeNull();
      expect(within(card).getByRole("button", { name: /Show overview/ })).toBeTruthy();
    }
  });

  it("shows no project hint on a group that has a project", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ repo: "acme/web", number: 3, projectIds: [] })])),
    );

    const reviews = await slot.findByRole("region", { name: "Direct" });
    expect(within(reviews).getAllByText("No bb project for this repository")).toHaveLength(1);
    expect(
      within(await findCard(slot, "Direct", "acme/api#15")).getByRole("button", {
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

    const card = await findCard(slot, "Direct", "acme/api#15");
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
      (call) => call.method === "getInsight" || call.method === "refresh",
    );
  }

  it.each([
    ["without a thread", queuePr({ projectIds: [] })],
    ["with a thread", queuePr({ thread: reviewThread })],
  ])("opens the overview when you click a row %s", async (_, pr) => {
    const slot = renderPanel("", () => ok(view([pr])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: /Show overview/ }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "pr/acme/api/15" } },
    ]);
  });

  it("shows the list and the overview of the selected PR", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getInsight: () => prInsight(),
    });

    const panel = await overview(slot);
    expect(await within(panel).findByRole("heading", { name: "Add rate limits" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: "Open on GitHub" }).getAttribute("href")).toBe(
      "https://github.com/acme/api/pull/15",
    );
    expect(slot.getByRole("region", { name: "Direct" })).toBeTruthy();
    expect(prInsightCalls(slot).map(({ method, input }) => ({ method, input }))).toEqual([
      { method: "getInsight", input: { threadId: "pr:acme/api#15" } },
    ]);
  });

  it("shows blockers, reviewers, and checks, with the Overview and Files tabs", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getInsight: () =>
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
        .getAllByRole("tab")
        .map((tab) => tab.querySelector("[data-tab-label]")?.textContent),
    ).toEqual(["Overview", "Files"]);
  });

  it("marks the selected row and closes the overview when you click it again", async () => {
    const slot = renderPanel(
      "pr/acme/api/15",
      () => ok(view([queuePr(), queuePr({ number: 12 })])),
      {
        getInsight: () => prInsight(),
      },
    );

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(card.getAttribute("aria-current")).toBe("true");
    const other = await findCard(slot, "Direct", "acme/api#12");
    expect(other.getAttribute("aria-current")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: /Hide overview/ }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "" } },
    ]);
  });

  it("goes back to the plain list on Close overview", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getInsight: () => prInsight(),
    });

    fireEvent.click(within(await overview(slot)).getByRole("button", { name: "Close overview" }));

    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toPluginPanel", path: "pull-requests", options: { subPath: "" } },
    ]);
  });

  it("asks the server to read GitHub again on Refresh", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getInsight: () => prInsight(),
      refresh: () => prInsight({ pr: { ...prTitle("Add rate limits v2") } }),
    });

    const panel = await overview(slot);
    fireEvent.click(await within(panel).findByRole("button", { name: "Refresh" }));

    expect(await within(panel).findByRole("heading", { name: "Add rate limits v2" })).toBeTruthy();
    expect(prInsightCalls(slot).map(({ method }) => method)).toEqual(["getInsight", "refresh"]);
  });

  it("keeps the last good overview when a refresh fails", async () => {
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getInsight: () => prInsight(),
      refresh: () => ({ kind: "error", message: "gh not logged in" }),
    });

    const panel = await overview(slot);
    fireEvent.click(await within(panel).findByRole("button", { name: "Refresh" }));

    expect((await within(panel).findByRole("alert")).textContent).toContain("gh not logged in");
    expect(within(panel).getByRole("heading", { name: "Add rate limits" })).toBeTruthy();
  });

  it("reloads when the server publishes an update for the PR", async () => {
    let title = "Add rate limits";
    const slot = renderPanel("pr/acme/api/15", () => ok(view([queuePr()])), {
      getInsight: () => prInsight({ pr: prTitle(title) }),
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
        getInsight: () => prInsight(),
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
      await findCard(slot, "Direct", "acme/api#15");

      fireEvent.click(within(panel).getByRole("button", { name: "Maximize overview" }));

      expect(slot.queryByRole("region", { name: "Direct" })).toBeNull();
      expect(within(panel).queryByRole("separator")).toBeNull();
      expect(saved()).toEqual({ width: 440, maximized: true });

      fireEvent.click(within(panel).getByRole("button", { name: "Restore overview" }));

      expect(slot.getByRole("region", { name: "Direct" })).toBeTruthy();
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
      expect(slot.queryByRole("region", { name: "Direct" })).toBeNull();
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

    await findCard(slot, "Direct", "acme/api#15");
    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("shows loading until the first background load is published", async () => {
    const slot = renderPanel("", () => ({ kind: "loading" }));

    expect(await slot.findByText("Loading pull requests…")).toBeTruthy();
    await slot.behavior.emitRealtime("review-queue.updated", ok(view([queuePr()])));

    expect(await findCard(slot, "Direct", "acme/api#15")).toBeTruthy();
    expect(slot.queryByText("Loading pull requests…")).toBeNull();
  });

  it("shows a published update without a call", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Direct", "acme/api#15");

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr(), queuePr({ number: 16, title: "Add caching" })])),
    );

    expect(await findCard(slot, "Direct", "acme/api#16")).toBeTruthy();
    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("ignores a malformed update", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Direct", "acme/api#15");

    await slot.behavior.emitRealtime("review-queue.updated", { kind: "ok" });

    expect(await findCard(slot, "Direct", "acme/api#15")).toBeTruthy();
  });

  it("asks the server to refresh on Refresh", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Direct", "acme/api#15");

    fireEvent.click(slot.getByRole("button", { name: "Refresh" }));

    await slot.findByRole("button", { name: "Refresh" });
    expect(rpcMethods(slot)).toEqual(["getReviewQueue", "refreshReviewQueue"]);
  });

  it("makes no calls of its own while open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Direct", "acme/api#15");

    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));

    expect(rpcMethods(slot)).toEqual(["getReviewQueue"]);
  });

  it("puts Refresh and the update time once, above the layers", async () => {
    const slot = renderPanel("", () =>
      ok({ ...view([queuePr()]), loadedAt: Date.now() - 3 * 60_000 }),
    );

    const section = await slot.findByRole("region", { name: "Direct" });
    const refresh = slot.getByRole("button", { name: "Refresh" });
    expect(section.contains(refresh)).toBe(false);
    expect(refresh.parentElement!.textContent).toContain("Updated 3 minutes ago");
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
    expect(slot.queryByRole("region", { name: "Direct" })).toBeNull();

    result = ok(view([queuePr()]));
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    await findCard(slot, "Direct", "acme/api#15");
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
    expect(await findCard(slot, "Direct", "acme/api#15")).toBeTruthy();
  });

  it("keeps the lists of an earlier load when a refresh fails", async () => {
    let result: ReviewQueueResult = ok(view([queuePr()]));
    const slot = renderPanel("", () => result);
    await findCard(slot, "Direct", "acme/api#15");

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

  it("puts the saved review instructions in the prompt", async () => {
    const pr = queuePr();
    const slot = renderPanel("review/acme/api/15", () => ok(view([pr])), {
      getReviewInstructions: () => ({
        instructions: "Check {repo} for N+1 queries.",
        isDefault: false,
      }),
    });

    const composer = await slot.findByTestId("bb-new-thread-composer");
    const prompt = (
      within(composer).getByTestId("bb-new-thread-composer-input") as HTMLTextAreaElement
    ).value;
    expect(prompt).toBe(buildReviewPrompt(pr, "Check {repo} for N+1 queries."));
    expect(prompt).toContain("Check acme/api for N+1 queries.");
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
  it("shows the layers above Reviewed, Merged, and Ignored", async () => {
    const slot = renderPanel("", () =>
      ok(
        view([
          queuePr(),
          queuePr({ number: 2, layer: "Teammates" }),
          queuePr({ number: 3, layer: "Team" }),
          queuePr({ number: 4, review: "reviewed" }),
          queuePr({ number: 5, state: "merged", closedAt: new Date().toISOString() }),
          queuePr({ number: 6, ignored: true }),
        ]),
      ),
    );

    await findCard(slot, "Direct", "acme/api#15");
    expect(slot.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual([
      "Direct",
      "Teammates",
      "Team",
      "Reviewed",
      "Merged",
      "Ignored",
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

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByText("New commits")).toBeTruthy();
  });

  it("shows no updated label on a PR that was never reviewed", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).queryByText("New commits")).toBeNull();
  });

  it.each([
    ["new_comments", "New comments"],
    ["requested_again", "Review requested again"],
  ] as const)("labels a marked PR with %s activity as %s", async (activity, label) => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ review: "reviewed", newActivity: [activity] })])),
    );

    const card = await findCard(slot, "Direct", "acme/api#15");
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

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByText("New commits")).toBeTruthy();
    expect(within(card).getByText("New comments")).toBeTruthy();
    expect(within(card).getByText("Review requested again")).toBeTruthy();
  });

  it("offers Mark reviewed on a marked PR that came back with new activity", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ review: "reviewed", newActivity: ["new_comments"] })])),
    );

    openActions(await findCard(slot, "Direct", "acme/api#15"));
    expect(await slot.findByRole("menuitem", { name: "Mark reviewed" })).toBeTruthy();
    expect(slot.queryByRole("menuitem", { name: "Mark as needs review" })).toBeNull();
  });

  it("shows no activity label on a PR without new activity", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Direct", "acme/api#15");
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

    const card = await findCard(slot, "Direct", "acme/api#15");
    await chooseAction(slot, card, "Mark reviewed");

    await vi.waitFor(() =>
      expect(
        within(card).getByRole("button", { name: "More actions" }).hasAttribute("disabled"),
      ).toBe(true),
    );
    const call = slot.inspection.rpcCalls.find((candidate) => candidate.method === "markReviewed");
    expect(call?.input).toEqual({ repo: "acme/api", number: 15, headOid: "head-15" });
    await act(async () => answer({ kind: "ok" }));
    expect(
      within(card).getByRole("button", { name: "More actions" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("moves the PR to Reviewed when the server publishes the mark", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));
    await findCard(slot, "Direct", "acme/api#15");

    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr({ review: "reviewed" })])),
    );

    const reviewed = await expandReviewed(slot);
    expect(within(reviewed).getByRole("listitem", { name: "acme/api#15" })).toBeTruthy();
    expect(slot.queryByRole("region", { name: "Direct" })).toBeNull();
  });

  it("keeps the PR and shows the error when the mark fails", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])), {
      markReviewed: () => ({ kind: "error", message: "disk full" }),
    });

    await chooseAction(slot, await findCard(slot, "Direct", "acme/api#15"), "Mark reviewed");

    expect(within(await slot.findByRole("alert")).getByText("disk full")).toBeTruthy();
    expect(await findCard(slot, "Direct", "acme/api#15")).toBeTruthy();
  });

  it("asks the server to mark a reviewed PR as needs review", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ review: "reviewed" })])));

    const reviewed = await expandReviewed(slot);
    const card = within(reviewed).getByRole("listitem", { name: "acme/api#15" });
    await chooseAction(slot, card, "Mark as needs review");

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

describe("Line counts on the PR row", () => {
  it("shows the lines added and removed", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ additions: 320, deletions: 389 })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    const counts = within(card).getByTestId("queue-line-counts");
    expect(counts.textContent).toBe("+320-389");
    expect(counts.getAttribute("title")).toBe("320 lines added, 389 removed");
  });

  it("shows no counts for a PR stored before they were read", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).queryByTestId("queue-line-counts")).toBeNull();
  });
});

describe("Re-review", () => {
  const idleReview = { ...reviewThread, status: "idle" as const };
  const changed = queuePr({ review: "updated_since_review", thread: idleReview, reReview: true });

  it("takes the place of an idle review thread's status when Re-review is due", async () => {
    const slot = renderPanel("", () => ok(view([changed])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByRole("button", { name: "Re-review" })).toBeTruthy();
    expect(within(card).queryByTestId("review-status")).toBeNull();
  });

  it("shows Re-review when the agent came back and the thread was not opened", async () => {
    const slot = renderPanel("", () =>
      ok(view([{ ...changed, thread: { ...idleReview, returned: "finished" } }])),
    );

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByRole("button", { name: "Re-review" })).toBeTruthy();
  });

  it.each([
    ["the agent runs", { thread: reviewThread }],
    ["nothing changed since the last re-review", { reReview: false }],
    [
      "the thread is not a review thread",
      { thread: { ...idleReview, id: "thr_branch", isReviewThread: false } },
    ],
  ] as const)("shows the thread status when %s", async (_, overrides) => {
    const slot = renderPanel("", () => ok(view([{ ...changed, ...overrides }])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).queryByRole("button", { name: "Re-review" })).toBeNull();
    expect(within(card).getByTestId("review-status")).toBeTruthy();
  });

  it("sends the thread and the head shown on the card, and stays in the list", async () => {
    let answer: (result: ActionResult) => void = () => {};
    const slot = renderPanel("", () => ok(view([changed])), {
      reReview: () => new Promise((resolve) => (answer = resolve)),
    });

    const card = await findCard(slot, "Direct", "acme/api#15");
    const button = within(card).getByRole("button", { name: "Re-review" });
    fireEvent.click(button);

    await vi.waitFor(() => expect(button.hasAttribute("disabled")).toBe(true));
    const call = slot.inspection.rpcCalls.find((candidate) => candidate.method === "reReview");
    expect(call?.input).toEqual({
      threadId: "thr_review",
      repo: "acme/api",
      number: 15,
      headOid: "head-15",
    });
    expect(slot.inspection.navigateCalls).toEqual([]);
    await act(async () => answer({ kind: "ok" }));
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("shows the error when the re-review could not be sent", async () => {
    const slot = renderPanel("", () => ok(view([changed])), {
      reReview: () => ({ kind: "error", message: "Thread is gone" }),
    });

    const card = await findCard(slot, "Direct", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: "Re-review" }));

    expect(await slot.findByText(/Thread is gone/)).toBeTruthy();
  });

  it("moves Open thread to the row menu", async () => {
    const slot = renderPanel("", () => ok(view([changed])));

    openActions(await findCard(slot, "Direct", "acme/api#15"));
    const items = await slot.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open in GitHub",
      "Open thread",
      "Mark reviewed",
      "Ignore",
      "Archive thread",
    ]);
    fireEvent.click(items[1]!);

    await vi.waitFor(() =>
      expect(slot.inspection.navigateCalls).toEqual([
        { method: "toThread", threadId: "thr_review" },
      ]),
    );
  });
});

describe("Thread on the PR row", () => {
  it.each([
    ["running", "Running"],
    ["needs_you", "Needs you"],
    ["idle", "Ready"],
    ["error", "Failed"],
  ] as const)("shows thread status %s", async (status, text) => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ thread: { ...reviewThread, status } })])),
    );

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByTestId("review-status").textContent).toBe(text);
  });

  it("names the thread button by its action and its status", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    const button = within(card).getByRole("button", { name: "Open thread: Running" });
    expect(within(button).getByTestId("review-status")).toBeTruthy();
    expect(within(within(card).getByTestId("queue-meta")).queryByText("Running")).toBeNull();
  });

  it("opens the thread from the row", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    fireEvent.click(within(card).getByRole("button", { name: /^Open thread/ }));

    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_review" }]);
  });

  it.each([
    [
      "a branch thread",
      { id: "thr_branch", status: "idle", isReviewThread: false, returned: null },
    ],
    ["no thread", null],
  ] as const)("offers no Archive thread for %s", async (_, thread) => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread })])));

    openActions(await findCard(slot, "Direct", "acme/api#15"));

    expect(await slot.findByRole("menuitem", { name: "Mark reviewed" })).toBeTruthy();
    expect(slot.queryByRole("menuitem", { name: "Archive thread" })).toBeNull();
  });

  it("lists Open in GitHub first and opens the PR on GitHub", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    openActions(await findCard(slot, "Direct", "acme/api#15"));
    const items = await slot.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Open in GitHub",
      "Mark reviewed",
      "Ignore",
      "Archive thread",
    ]);
    fireEvent.click(items[0]!);

    await vi.waitFor(() =>
      expect(slot.inspection.navigateCalls).toEqual([
        { method: "openUrl", url: "https://github.com/acme/api/pull/15" },
      ]),
    );
  });

  it("offers Archive thread for a review thread", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    openActions(await findCard(slot, "Direct", "acme/api#15"));

    expect(await slot.findByRole("menuitem", { name: "Archive thread" })).toBeTruthy();
  });

  it("archives the review thread and offers Start review again without a refresh", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ thread: reviewThread })])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    await chooseAction(slot, card, "Archive thread");

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

    const card = await findCard(slot, "Direct", "acme/api#15");
    await chooseAction(slot, card, "Archive thread");

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

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByTestId("review-status").textContent).toBe(text);
  });

  it("shows an opened idle thread as Ready too", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ thread: { ...reviewThread, status: "idle" } })])),
    );

    const card = await findCard(slot, "Direct", "acme/api#15");
    expect(within(card).getByTestId("review-status").textContent).toBe("Ready");
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

  it("counts agent states above the layers, with idle threads under Ready", async () => {
    const slot = renderPanel("", agentQueue);

    await slot.findByRole("region", { name: "Direct" });
    const filter = slot.getByRole("group", { name: "Filter by agent status" });
    expect(
      within(filter)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Running 2", "Needs you 1", "Ready 1"]);
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

    const reviews = await slot.findByRole("region", { name: "Direct" });
    fireEvent.click(slot.getByRole("button", { name: "Failed 2" }));
    expect(
      within(reviews)
        .getAllByTestId("review-status")
        .map((status) => status.textContent),
    ).toEqual(["Failed", "Failed"]);
    expect(slot.getByRole("button", { name: "Ready 1" })).toBeTruthy();
  });

  it("hides the filter and shows Nothing to review when the list empties under a filter", async () => {
    const slot = renderPanel("", agentQueue);

    await slot.findByRole("region", { name: "Direct" });
    fireEvent.click(slot.getByRole("button", { name: "Running 2" }));
    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok({ ...view([]), teammatesTeam: "acme/core" }),
    );

    await slot.findByText("Nothing to review");
    expect(slot.queryByRole("group", { name: "Filter by agent status" })).toBeNull();
  });

  it("shows no filter when no PR has a thread", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ number: 1 }), queuePr({ number: 2 })])));

    await slot.findByRole("region", { name: "Direct" });
    expect(slot.queryByRole("group", { name: "Filter by agent status" })).toBeNull();
  });

  it("shows only the rows in the chosen state and keeps the total count", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Direct" });
    const runningFilter = slot.getByRole("button", { name: "Running 2" });
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

    const reviews = await slot.findByRole("region", { name: "Direct" });
    const needsYouFilter = slot.getByRole("button", { name: "Needs you 1" });
    fireEvent.click(needsYouFilter);
    expect(visibleCards(reviews)).toEqual(["acme/web#3"]);

    fireEvent.click(needsYouFilter);
    expect(needsYouFilter.getAttribute("aria-pressed")).toBe("false");
    expect(visibleCards(reviews)).toHaveLength(5);
  });

  it("keeps the chosen filter and offers to clear it when its last agent stops", async () => {
    const slot = renderPanel("", agentQueue);

    const reviews = await slot.findByRole("region", { name: "Direct" });
    fireEvent.click(slot.getByRole("button", { name: "Needs you 1" }));
    await slot.behavior.emitRealtime(
      "review-queue.updated",
      ok(view([queuePr({ number: 1, thread: running }), queuePr({ number: 3, thread: idle })])),
    );

    await within(reviews).findByText("No pull requests match this filter");
    expect(slot.getByRole("button", { name: "Needs you 0" })).toBeTruthy();
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

    await findCard(slot, "Direct", "acme/api#15");
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

  it("names the CI state of a row", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ ci: "failed" })])));

    const card = await findCard(slot, "Direct", "acme/api#15");

    expect(within(card).getByRole("img", { name: "CI failed" }).getAttribute("title")).toBe(
      "CI failed",
    );
  });

  it.each([
    [/^Open thread/, queuePr({ thread: reviewThread })],
    ["Start review", queuePr()],
  ])("shows no tooltip on %s", async (name, pr) => {
    const slot = renderPanel("", () => ok(view([pr])));

    const card = await findCard(slot, "Direct", "acme/api#15");
    const button = within(card).getByRole("button", { name });
    hover(button);
    focusWithKeyboard(button);

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(slot.queryByRole("tooltip")).toBeNull();
  });
});

describe("review layers", () => {
  it("lists each layer with its own count", async () => {
    const slot = renderPanel("", () =>
      ok(
        view([
          queuePr(),
          queuePr({ repo: "acme/web", number: 3, layer: "Team" }),
          queuePr({ repo: "acme/web", number: 4, layer: "Team" }),
        ]),
      ),
    );

    const team = await slot.findByRole("region", { name: "Team" });
    expect(within(team).getByTestId("queue-count").textContent).toBe("2");
    expect(
      within(team)
        .getAllByRole("listitem")
        .map((card) => card.getAttribute("aria-label")),
    ).toEqual(["acme/web#3", "acme/web#4"]);
  });

  it("dims a PR with a skip label, shows the label, and leaves it out of the count", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr(), queuePr({ number: 16, skipLabel: "DO NOT REVIEW" })])),
    );

    const card = await findCard(slot, "Direct", "acme/api#16");
    expect(within(card).getByTestId("queue-skip-label").textContent).toBe("DO NOT REVIEW");
    expect(card.className).toContain("opacity-60");
    const direct = slot.getByRole("region", { name: "Direct" });
    expect(within(direct).getByTestId("queue-count").textContent).toBe("1");
  });

  it("ignores a PR from its card", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    await chooseAction(slot, await findCard(slot, "Direct", "acme/api#15"), "Ignore");

    await vi.waitFor(() =>
      expect(slot.inspection.rpcCalls.find((call) => call.method === "ignorePr")?.input).toEqual({
        repo: "acme/api",
        number: 15,
      }),
    );
  });

  it("lists an ignored PR under Ignored with a way to stop ignoring it", async () => {
    const slot = renderPanel("", () => ok(view([queuePr({ ignored: true })])));

    const ignored = await slot.findByRole("region", { name: "Ignored" });
    fireEvent.click(within(ignored).getByRole("button", { expanded: false }));
    await chooseAction(slot, await findCard(slot, "Ignored", "acme/api#15"), "Stop ignoring");

    await vi.waitFor(() => expect(rpcMethods(slot)).toContain("unignorePr"));
  });

  it("offers no Ignore button on a merged PR", async () => {
    const slot = renderPanel("", () =>
      ok(view([queuePr({ state: "merged", closedAt: new Date().toISOString() })])),
    );

    const merged = await slot.findByRole("region", { name: "Merged" });
    fireEvent.click(within(merged).getByRole("button", { expanded: false }));
    openActions(await findCard(slot, "Merged", "acme/api#15"));
    expect(await slot.findByRole("menuitem", { name: "Mark reviewed" })).toBeTruthy();
    expect(slot.queryByRole("menuitem", { name: "Ignore" })).toBeNull();
  });

  it.each([
    ["Hide from Direct", "Direct"],
    ["Hide everywhere", null],
  ] as const)("hides a repository with %s", async (item, layer) => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const direct = await slot.findByRole("region", { name: "Direct" });
    fireEvent.keyDown(within(direct).getByRole("button", { name: "Hide acme/api" }), {
      key: "Enter",
    });
    fireEvent.click(await slot.findByRole("menuitem", { name: item }));

    await vi.waitFor(() =>
      expect(slot.inspection.rpcCalls.find((call) => call.method === "hideRepo")?.input).toEqual({
        repo: "acme/api",
        layer,
      }),
    );
  });

  it("lists every hidden repository in one menu above the layers and shows one again", async () => {
    const queue = view([queuePr()]);
    queue.layers[2]!.hiddenRepos = ["acme/web"];
    const slot = renderPanel("", () => ok({ ...queue, hiddenEverywhere: ["acme/docs"] }));

    await slot.findByRole("region", { name: "Direct" });
    expect(slot.getAllByRole("button", { name: /hidden$/ })).toHaveLength(1);
    fireEvent.keyDown(slot.getByRole("button", { name: "2 hidden" }), { key: "Enter" });
    expect(await slot.findByText("Hidden from Team")).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Show acme/docs again" })).toBeTruthy();
    fireEvent.click(slot.getByRole("menuitem", { name: "Show acme/web again" }));

    await vi.waitFor(() =>
      expect(slot.inspection.rpcCalls.find((call) => call.method === "showRepo")?.input).toEqual({
        repo: "acme/web",
        layer: "Team",
      }),
    );
  });
});

describe("teammates layer", () => {
  it("asks you to pick your team until one is picked", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])));

    const teammates = await slot.findByRole("region", { name: "Teammates" });
    expect(within(teammates).getByText(/Pick your team to list/)).toBeTruthy();
    expect(slot.getByRole("button", { name: "Pick your team" })).toBeTruthy();
  });

  it("lists your teams and saves the one you pick", async () => {
    const slot = renderPanel("", () => ok(view([queuePr()])), {
      getViewerTeams: () => ({
        kind: "ok",
        teams: [
          { team: "acme/core", name: "Core" },
          { team: "acme/everyone", name: "Everyone" },
        ],
      }),
    });

    await slot.findByRole("region", { name: "Teammates" });
    fireEvent.keyDown(slot.getByRole("button", { name: "Pick your team" }), { key: "Enter" });
    fireEvent.click(await slot.findByRole("menuitem", { name: /Core/ }));

    await vi.waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((call) => call.method === "setTeammatesTeam")?.input,
      ).toEqual({ team: "acme/core" }),
    );
  });

  it("shows the picked team and why its members could not be read", async () => {
    const slot = renderPanel("", () =>
      ok({ ...view([queuePr()]), teammatesTeam: "acme/core", teammatesError: "HTTP 404" }),
    );

    const teammates = await slot.findByRole("region", { name: "Teammates" });
    expect(slot.getByRole("button", { name: "acme/core" })).toBeTruthy();
    expect(
      within(teammates).getByText(/Could not read the members of acme\/core: HTTP 404/),
    ).toBeTruthy();
  });
});

describe("review prompt settings", () => {
  const section = app.settingsSections.find((registration) => registration.id === "review-prompt")!;

  function renderSettings(rpc: Partial<PanelRpc> = {}) {
    return renderSlot<Record<string, never>, typeof rpcContract>(
      section,
      {},
      { rpc: panelRpc(() => ok(view([])), rpc) },
    );
  }

  it("registers a Review prompt section on the plugin settings page", () => {
    expect(section).toMatchObject({ title: "Review prompt" });
  });

  it("saves edited instructions and says the next review uses them", async () => {
    const slot = renderSettings();

    const box = (await slot.findByRole("textbox")) as HTMLTextAreaElement;
    expect(box.value).toBe(DEFAULT_REVIEW_INSTRUCTIONS);
    fireEvent.change(box, { target: { value: "Check {repo} for N+1 queries." } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));

    await slot.findByText("Saved. The next review uses it.");
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "setReviewInstructions")?.input,
    ).toEqual({ instructions: "Check {repo} for N+1 queries.", prompt: "review" });
  });

  it("shows the plugin's part of the prompt above the editable part, always open", async () => {
    const slot = renderSettings();

    const box = await slot.findByRole("textbox", { name: "Yours to edit" });
    const head = slot.getByTestId("prompt-head");
    expect(head.textContent).toBe(
      reviewPromptHead({
        number: 123,
        title: "Add rate limits",
        url: "https://github.com/acme/api/pull/123",
        repo: "acme/api",
      }),
    );
    expect(head.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(slot.getAllByRole("textbox")).toHaveLength(1);
    expect(slot.container.querySelector("details")).toBeNull();
  });

  it("does not save empty instructions", async () => {
    const slot = renderSettings();

    fireEvent.change(await slot.findByRole("textbox"), { target: { value: "  " } });

    expect(slot.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
    expect(slot.getByText("The instructions cannot be empty.")).toBeTruthy();
  });

  it("resets saved instructions to the default", async () => {
    const slot = renderSettings({
      getReviewInstructions: () => ({ instructions: "Mine", isDefault: false }),
    });

    expect(((await slot.findByRole("textbox")) as HTMLTextAreaElement).value).toBe("Mine");
    fireEvent.click(slot.getByRole("button", { name: "Reset to default" }));

    await vi.waitFor(() =>
      expect((slot.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        DEFAULT_REVIEW_INSTRUCTIONS,
      ),
    );
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "setReviewInstructions")?.input,
    ).toEqual({ instructions: null, prompt: "review" });
  });
});

describe("auto-review settings", () => {
  const section = app.settingsSections.find((registration) => registration.id === "auto-review")!;

  function renderSettings(rpc: Partial<PanelRpc> = {}) {
    return renderSlot<Record<string, never>, typeof rpcContract>(
      section,
      {},
      { rpc: panelRpc(() => ok(view([])), rpc) },
    );
  }

  it("turns auto-review on with the saved limit", async () => {
    const slot = renderSettings({ getAutoReview: () => ({ enabled: false, maxRunning: 4 }) });

    const toggle = (await slot.findByRole("checkbox", {
      name: "Start reviews on their own for Direct and Teammates PRs",
    })) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    fireEvent.click(toggle);

    await vi.waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((call) => call.method === "setAutoReview")?.input,
      ).toEqual({ enabled: true, maxRunning: 4 }),
    );
    expect(toggle.checked).toBe(true);
  });

  it("saves a new limit", async () => {
    const slot = renderSettings({ getAutoReview: () => ({ enabled: true, maxRunning: 3 }) });

    const limit = await slot.findByRole("combobox", {
      name: "Review threads working at once, at most",
    });
    fireEvent.change(limit, { target: { value: "2" } });

    await vi.waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((call) => call.method === "setAutoReview")?.input,
      ).toEqual({ enabled: true, maxRunning: 2 }),
    );
  });

  it("puts the toggle back and says why when saving fails", async () => {
    const slot = renderSettings({
      getAutoReview: () => ({ enabled: false, maxRunning: 3 }),
      setAutoReview: () => ({ kind: "error" as const, message: "kv down" }),
    });

    const toggle = (await slot.findByRole("checkbox")) as HTMLInputElement;
    fireEvent.click(toggle);

    await slot.findByText("Could not save: kv down");
    expect(toggle.checked).toBe(false);
  });
});

describe("re-review prompt settings", () => {
  const section = app.settingsSections.find(
    (registration) => registration.id === "re-review-prompt",
  )!;

  function renderSettings(rpc: Partial<PanelRpc> = {}) {
    return renderSlot<Record<string, never>, typeof rpcContract>(
      section,
      {},
      { rpc: panelRpc(() => ok(view([])), rpc) },
    );
  }

  it("registers a Re-review prompt section after the Review prompt one", () => {
    expect(section).toMatchObject({ title: "Re-review prompt" });
    expect(app.settingsSections.map((registration) => registration.id)).toEqual([
      "auto-review",
      "review-prompt",
      "re-review-prompt",
    ]);
  });

  it("reads the re-review instructions and shows the re-review head above them", async () => {
    const slot = renderSettings({
      getReviewInstructions: () => ({
        instructions: DEFAULT_RE_REVIEW_INSTRUCTIONS,
        isDefault: true,
      }),
    });

    const box = (await slot.findByRole("textbox")) as HTMLTextAreaElement;
    expect(box.value).toBe(DEFAULT_RE_REVIEW_INSTRUCTIONS);
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "getReviewInstructions")?.input,
    ).toEqual({ prompt: "re-review" });
    const head = slot.getByTestId("prompt-head").textContent ?? "";
    expect(head.startsWith("Re-review pull request #123: Add rate limits")).toBe(true);
    expect(head).toContain("I reviewed this PR at commit 3f2a9c1e7b4d");
    expect(head).toContain("## Steps");
    expect(head).not.toContain("## How to review");
  });

  it("saves the re-review instructions and says the next re-review uses them", async () => {
    const slot = renderSettings({
      getReviewInstructions: () => ({
        instructions: DEFAULT_RE_REVIEW_INSTRUCTIONS,
        isDefault: true,
      }),
    });

    fireEvent.change(await slot.findByRole("textbox"), { target: { value: "Only check tests." } });
    fireEvent.click(slot.getByRole("button", { name: "Save" }));

    await slot.findByText("Saved. The next re-review uses it.");
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "setReviewInstructions")?.input,
    ).toEqual({ instructions: "Only check tests.", prompt: "re-review" });
  });

  it("resets to the re-review default", async () => {
    const slot = renderSettings({
      getReviewInstructions: () => ({ instructions: "Mine", isDefault: false }),
    });

    await slot.findByRole("textbox");
    fireEvent.click(slot.getByRole("button", { name: "Reset to default" }));

    await vi.waitFor(() =>
      expect((slot.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
        DEFAULT_RE_REVIEW_INSTRUCTIONS,
      ),
    );
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "setReviewInstructions")?.input,
    ).toEqual({ instructions: null, prompt: "re-review" });
  });
});

describe("Activity tab", () => {
  const feed = activityOk([
    activityPr([
      activityItem(),
      activityItem({ id: "PRRC_2", kind: "reply", actor: "carol", place: "inline" }),
      activityItem({ id: "C3", actor: "dan", read: true }),
    ]),
  ]);

  function renderActivity(subPath = "activity", rpc: Partial<PanelRpc> = {}) {
    return renderPanel(subPath, () => ok(view([])), { getActivity: () => feed, ...rpc });
  }

  it("shows the unread count on the tab and the unread items by PR", async () => {
    const slot = renderActivity();

    const group = await slot.findByRole("region", { name: "acme/api#7" });
    expect(
      within(group)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("aria-label")),
    ).toEqual(["bob commented", "carol replied"]);
    expect(within(group).getByText("Your PR")).toBeTruthy();
    expect(slot.getByTestId("activity-unread").textContent).toBe("2 unread");
    expect(slot.getByRole("tab", { name: /Activity/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("opens a conversation comment in the PR view and marks it read", async () => {
    const slot = renderActivity();

    const group = await slot.findByRole("region", { name: "acme/api#7" });
    fireEvent.click(
      within(within(group).getByRole("listitem", { name: "bob commented" })).getAllByRole(
        "button",
      )[0]!,
    );

    expect(slot.inspection.navigateCalls).toEqual([
      {
        method: "toPluginPanel",
        path: "pull-requests",
        options: { subPath: "activity/pr/acme/api/7/conversation/C1" },
      },
    ]);
    await vi.waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((call) => call.method === "markActivityRead")?.input,
      ).toEqual({ ids: ["C1"] }),
    );
  });

  it("opens an inline reply on the Files tab of the PR view", async () => {
    const slot = renderActivity("activity/pr/acme/api/7/inline/PRRC_2");

    const panel = await slot.findByRole("complementary", { name: "Pull request overview" });
    expect(within(panel).getByRole("tab", { name: /Files/ }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(slot.inspection.rpcCalls.map((call) => call.method)).toContain("getReview");
  });

  it("shows read items on request", async () => {
    const slot = renderActivity();

    fireEvent.click(await slot.findByRole("button", { name: "Show 1 read" }));

    const group = slot.getByRole("region", { name: "acme/api#7" });
    expect(within(group).getAllByRole("listitem")).toHaveLength(3);
  });

  it("mutes a person from an item's menu", async () => {
    const slot = renderActivity();

    const group = await slot.findByRole("region", { name: "acme/api#7" });
    openActions(within(group).getByRole("listitem", { name: "bob commented" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Mute bob" }));

    await vi.waitFor(() =>
      expect(
        slot.inspection.rpcCalls.find((call) => call.method === "setActivityMuted")?.input,
      ).toEqual({ login: "bob", muted: true }),
    );
  });

  it("marks everything read", async () => {
    const slot = renderActivity();

    fireEvent.click(await slot.findByRole("button", { name: "Mark all read" }));

    await vi.waitFor(() => expect(rpcMethods(slot)).toContain("markAllActivityRead"));
  });

  it("says when nothing is unread", async () => {
    const slot = renderActivity("activity", { getActivity: () => activityOk([]) });

    expect(await slot.findByText(/No new comments, replies, or mentions/)).toBeTruthy();
  });
});
