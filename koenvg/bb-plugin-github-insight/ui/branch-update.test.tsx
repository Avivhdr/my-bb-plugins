// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { ActionResult, InsightResult, LocalCommitsAhead, rpcContract } from "../contract";
import type { PrInsight } from "../core/overview";
import { forgetInsights } from "./pr-availability";

type Methods = Pick<
  typeof rpcContract,
  "getInsight" | "refresh" | "runPrAction" | "localCommitsAhead" | "getTimeline"
>;
const app = await loadPluginApp(() => import("../app"));
const tab = app.threadPanelActions.find((action) => action.id === "pr")!;
const banner = app.composerCustomizations.find((entry) => entry.id === "pr-insight")!.banners![0]!;

const HEAD = "head-a";
const behind: PrInsight = {
  pr: {
    number: 42,
    title: "Behind branch",
    state: "open",
    url: "https://github.com/o/r/pull/42",
    headOid: HEAD,
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
  autoMergeAction: { kind: "none" },
  canUpdateBranch: true,
  blockers: [{ code: "behind", text: "Branch out of date" }],
  checks: [],
  reviewers: [],
  mergeQueue: null,
};

function ok(insight: PrInsight): InsightResult {
  return { kind: "ok", insight, refreshedAt: Date.now(), error: null };
}

function renderTab({
  insight = behind,
  runPrAction = async (): Promise<ActionResult> => ({ kind: "ok" }),
  localCommits = { kind: "count", count: 0 } as LocalCommitsAhead,
}: {
  insight?: PrInsight;
  runPrAction?: (input: {
    action: string;
    expectedHeadOid: string;
  }) => ActionResult | Promise<ActionResult>;
  localCommits?: LocalCommitsAhead;
} = {}) {
  const run = vi.fn(runPrAction);
  const localCommitsAhead = vi.fn(async () => localCommits);
  const slot = renderSlot<PluginThreadPanelProps, Methods>(
    tab,
    { threadId: "thr_update", params: null },
    {
      rpc: {
        getInsight: async () => ok(insight),
        refresh: async () => ok(insight),
        runPrAction: run,
        localCommitsAhead,
        getTimeline: () => ({ kind: "no_pr" as const }),
      },
    },
  );
  return { view: within(slot.container), run, localCommitsAhead };
}

async function openMenu(view: ReturnType<typeof within>) {
  fireEvent.click(await view.findByRole("button", { name: "More update options" }));
}

afterEach(() => {
  cleanup();
  forgetInsights();
});

describe("Update branch", () => {
  it("shows for a branch that is behind", async () => {
    const { view } = renderTab();

    expect(await view.findByRole("button", { name: "Update branch" })).toBeTruthy();
  });

  it("does not show for a branch that cannot update", async () => {
    const { view } = renderTab({ insight: { ...behind, canUpdateBranch: false } });
    await view.findByText("#42");

    expect(view.queryByRole("button", { name: "Update branch" })).toBeNull();
  });

  it("updates with a merge at once, without a dialog", async () => {
    const { view, run } = renderTab();

    fireEvent.click(await view.findByRole("button", { name: "Update branch" }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toMatchObject({ action: "update-merge", expectedHeadOid: HEAD });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("checks local commits when the menu opens", async () => {
    const { view, localCommitsAhead } = renderTab();

    await openMenu(view);

    await waitFor(() => expect(localCommitsAhead).toHaveBeenCalledTimes(1));
  });

  it("rebases after the user confirms", async () => {
    const { view, run } = renderTab();
    await openMenu(view);

    fireEvent.click(await view.findByRole("button", { name: "Update with rebase…" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("#42");
    expect(dialog.textContent).toContain("local branch will no longer match");
    fireEvent.click(within(dialog).getByRole("button", { name: "Update with rebase" }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[0]![0]).toMatchObject({ action: "update-rebase", expectedHeadOid: HEAD });
  });

  it("does not rebase when the user cancels", async () => {
    const { view, run } = renderTab();
    await openMenu(view);

    fireEvent.click(await view.findByRole("button", { name: "Update with rebase…" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Cancel" }),
    );

    await act(async () => {});
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it("blocks the rebase while the worktree has unpushed commits", async () => {
    const { view } = renderTab({ localCommits: { kind: "count", count: 2 } });
    await openMenu(view);

    expect(await view.findByText("2 unpushed commits. Push first.")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Update with rebase…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (view.getByRole("button", { name: "Update branch" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("shows the newest local commit check when an older one answers late", async () => {
    const answers: ((result: LocalCommitsAhead) => void)[] = [];
    const { view, localCommitsAhead } = renderTab();
    localCommitsAhead.mockImplementation(
      () => new Promise<LocalCommitsAhead>((resolve) => answers.push(resolve)),
    );
    const toggle = await view.findByRole("button", { name: "More update options" });

    fireEvent.click(toggle);
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    await act(async () => answers[1]!({ kind: "count", count: 0 }));
    await act(async () => answers[0]!({ kind: "count", count: 3 }));

    expect(view.queryByText("3 unpushed commits. Push first.")).toBeNull();
    expect(
      (view.getByRole("button", { name: "Update with rebase…" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("blocks the rebase when the check cannot run", async () => {
    const { view } = renderTab({ localCommits: { kind: "unknown" } });
    await openMenu(view);

    expect(await view.findByText("Cannot check local commits")).toBeTruthy();
    expect(
      (view.getByRole("button", { name: "Update with rebase…" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("shows Updating… and sends one update for a double click", async () => {
    let finish!: (result: ActionResult) => void;
    const { view, run } = renderTab({
      runPrAction: () => new Promise((resolve) => (finish = resolve)),
    });
    const button = await view.findByRole("button", { name: "Update branch" });

    fireEvent.click(button);
    fireEvent.click(button);

    const busy = await view.findByRole("button", { name: "Updating…" });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    await act(async () => finish({ kind: "ok" }));
  });

  it("shows the GitHub error and enables the button again", async () => {
    const { view } = renderTab({
      runPrAction: () => ({ kind: "error", message: "Head branch was modified" }),
    });

    fireEvent.click(await view.findByRole("button", { name: "Update branch" }));

    expect((await view.findByRole("alert")).textContent).toContain("Head branch was modified");
    expect(
      (view.getByRole("button", { name: "Update branch" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("reminds the user to pull after an update, until dismissed", async () => {
    const { view } = renderTab();

    fireEvent.click(await view.findByRole("button", { name: "Update branch" }));

    expect(await view.findByText("Branch updated on GitHub. Pull before you push.")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    expect(view.queryByText("Branch updated on GitHub. Pull before you push.")).toBeNull();
  });

  it("is not offered in the composer banner", async () => {
    const slot = renderSlot<object, Methods>(
      banner,
      {},
      {
        rpc: {
          getInsight: async () => ok(behind),
          refresh: async () => ok(behind),
          runPrAction: async () => ({ kind: "ok" }),
          localCommitsAhead: async () => ({ kind: "unknown" }),
          getTimeline: () => ({ kind: "no_pr" }),
        },
        composer: { scope: { kind: "thread", threadId: "thr_update" } },
      },
    );

    await within(slot.container).findByText("Branch out of date");
    expect(within(slot.container).queryByRole("button", { name: /update/i })).toBeNull();
  });
});
