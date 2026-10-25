// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { clearIssuesFilterSession } from "./core/filterSession";

const PROJECTS = [
  { id: "proj_1", name: "acme", kind: "standard", gitRemoteUrl: null, createdAt: 0, updatedAt: 0 },
  { id: "proj_2", name: "widgets", kind: "standard", gitRemoteUrl: null, createdAt: 0, updatedAt: 0 },
];

function issue(number: number, title: string, labels: string[], body: string | null = null) {
  return {
    number,
    title,
    body,
    state: "open",
    html_url: `https://github.com/acme/repo/issues/${number}`,
    labels: labels.map((name) => ({ name, color: name === "bug" ? "d73a4a" : "0e8a16" })),
    linked_pull_requests: [],
  };
}

function dependency(number: number) {
  return {
    number,
    title: `Issue ${number}`,
    html_url: `https://github.com/acme/repo/issues/${number}`,
    state: "open",
    repo: "acme/repo",
  };
}

/** #1 blocks #2; #3 has no links. */
function dependencyBoard() {
  return boardResponse({
    issues: [
      { ...issue(1, "Crash on save", ["bug"]), blocking: [dependency(2)], blocking_open_count: 1 },
      { ...issue(2, "Dark mode", ["feature"]), blocked_by: [dependency(1)], blocked_by_open_count: 1 },
      issue(3, "Unsorted idea", []),
    ],
  });
}

function boardResponse(overrides: Record<string, unknown> = {}) {
  return {
    repo: { owner: "acme", name: "repo" },
    issues: [
      issue(1, "Crash on save", ["bug"], "Stack trace mentions the autosaver"),
      issue(2, "Dark mode", ["feature"]),
      issue(3, "Unsorted idea", []),
    ],
    labels: [
      { name: "bug", color: "d73a4a" },
      { name: "feature", color: "0e8a16" },
    ],
    values: { "2": 8 },
    columnLabels: ["bug", "feature"],
    threadLinks: {},
    ...overrides,
  };
}

async function renderPage(
  options: {
    subPath?: string;
    rpc?: Record<string, (input: never) => unknown>;
  } = {},
) {
  const app = await loadPluginApp(() => import("./app"));
  const panel = app.navPanels[0]!;
  const slot = renderSlot(
    panel,
    { subPath: options.subPath ?? "proj_1" },
    {
      pluginId: "issues",
      sdk: { projects: { list: async () => PROJECTS } } as never,
      rpc: {
        issues_get_board: () => boardResponse(),
        issues_ai_status: () => ({ ready: false }),
        issues_get_collapsed_columns: () => [],
        issues_set_collapsed_columns: () => null,
        ...options.rpc,
      },
    },
  );
  return slot;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  clearIssuesFilterSession();
  vi.restoreAllMocks();
});

describe("Issues page", () => {
  it("lays out one tray per curated label plus Other", async () => {
    const slot = await renderPage();

    const bug = await slot.findByRole("region", { name: "bug" });
    expect(within(bug).getByText("Crash on save")).toBeTruthy();
    expect(within(slot.getByRole("region", { name: "feature" })).getByText("Dark mode")).toBeTruthy();
    expect(within(slot.getByRole("region", { name: "No label / Other" })).getByText("Unsorted idea")).toBeTruthy();
    expect(slot.getByText("acme/repo")).toBeTruthy();
  });

  it("opens the first project when the route names none", async () => {
    const slot = await renderPage({ subPath: "" });

    await slot.findByText("Crash on save");
    expect(slot.inspection.navigateCalls).toContainEqual(
      { method: "toPluginPanel", path: "board", options: { subPath: "proj_1", replace: true } },
    );
  });

  it("filters by keyword, matching the body too", async () => {
    const slot = await renderPage();
    await slot.findByText("Crash on save");

    fireEvent.change(slot.getByRole("searchbox", { name: "Search issues" }), { target: { value: "autosaver" } });

    expect(slot.getByText("1 of 3")).toBeTruthy();
    expect(slot.queryByText("Dark mode")).toBeNull();
    expect(slot.getByText("Crash on save")).toBeTruthy();
  });

  it("opens the new thread screen from an issue with the issue link", async () => {
    const slot = await renderPage();
    const bug = await slot.findByRole("region", { name: "bug" });

    fireEvent.click(within(bug).getByText("Crash on save"));
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Start thread/ }));

    const prompt = "https://github.com/acme/repo/issues/1\n";
    expect(slot.inspection.composer.text).toBe(prompt);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toCompose",
      options: { projectId: "proj_1", initialPrompt: prompt, focusPrompt: true },
    });
    expect(slot.inspection.rpcCalls.some((call) => call.method === "issues_start_thread")).toBe(false);
  });

  it("shows a chip for the thread linked to an issue", async () => {
    const slot = await renderPage({
      rpc: {
        issues_get_board: () => boardResponse({ threadLinks: { "1": { threadId: "thr_1", title: "Crash on save" } } }),
      },
    });

    fireEvent.click(await slot.findByRole("button", { name: "Open thread: Crash on save" }));

    expect(slot.inspection.navigateCalls).toContainEqual(
      expect.objectContaining({ method: "toThread", threadId: "thr_1" }),
    );
  });

  it("creates an issue without AI and shows it at once", async () => {
    const slot = await renderPage({
      rpc: {
        issues_create_issue: () => ({ issue: issue(4, "Add export", ["feature"]) }),
      },
    });
    await slot.findByText("Crash on save");

    fireEvent.click(slot.getByRole("button", { name: "Create" }));
    const dialog = await slot.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Describe the issue"), { target: { value: "Add export" } });
    expect(within(dialog).getByRole("button", { name: "Refine" })).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Skip AI" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "feature" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Create issue" }));

    const feature = await slot.findByRole("region", { name: "feature" });
    expect(within(feature).getByText("Add export")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "issues_create_issue",
        input: { projectId: "proj_1", title: "Add export", body: "", labels: ["feature"] },
      }),
    );
  });

  it("asks before discarding an unsaved title", async () => {
    const slot = await renderPage();
    const bug = await slot.findByRole("region", { name: "bug" });

    fireEvent.click(within(bug).getByText("Crash on save"));
    const dialog = await slot.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Title"), { target: { value: "Crash on autosave" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(await slot.findByRole("alertdialog")).toBeTruthy();
    expect(slot.getByText("#1 has unsaved changes")).toBeTruthy();
  });

  it("offers to name the repository when the project has no remote", async () => {
    let repo: string | null = null;
    const slot = await renderPage({
      rpc: {
        issues_get_board: () => {
          if (repo === null) throw new Error("No GitHub repository found for acme: its checkout has no git remote.");
          return boardResponse();
        },
        issues_set_repo: ((input: { repo: string }) => {
          repo = input.repo;
          return null;
        }) as never,
      },
    });

    expect(await slot.findByText(/its checkout has no git remote/)).toBeTruthy();
    fireEvent.change(slot.getByRole("textbox", { name: "GitHub repository" }), { target: { value: "acme/repo" } });
    await act(async () => {
      fireEvent.click(slot.getByRole("button", { name: "Use repository" }));
    });

    expect(await slot.findByText("Crash on save")).toBeTruthy();
    expect(repo).toBe("acme/repo");
  });

  it("marks blocked and blocking issues on their cards", async () => {
    const slot = await renderPage({ rpc: { issues_get_board: () => dependencyBoard() } });

    const feature = await slot.findByRole("region", { name: "feature" });
    expect(within(feature).getByText("Blocked by")).toBeTruthy();
    expect(within(feature).getByRole("button", { name: /Show #1 Issue 1, which blocks this issue/ })).toBeTruthy();
    const bug = slot.getByRole("region", { name: "bug" });
    expect(within(bug).getByText("Blocks")).toBeTruthy();
  });

  it("filters the board to blocked, blocking, or unblocked issues", async () => {
    const slot = await renderPage({ rpc: { issues_get_board: () => dependencyBoard() } });
    await slot.findByText("Crash on save");
    const filter = slot.getByRole("radiogroup", { name: "Filter issues by dependency" });

    fireEvent.click(within(filter).getByRole("radio", { name: "Show blocked issues" }));
    expect(slot.getByText("Dark mode")).toBeTruthy();
    expect(slot.queryByText("Crash on save")).toBeNull();
    expect(slot.queryByText("Unsorted idea")).toBeNull();

    fireEvent.click(within(filter).getByRole("radio", { name: "Show blocking issues" }));
    expect(slot.getByText("Crash on save")).toBeTruthy();
    expect(slot.queryByText("Dark mode")).toBeNull();

    fireEvent.click(within(filter).getByRole("radio", { name: "Show issues that are not blocked" }));
    expect(slot.getByText("Crash on save")).toBeTruthy();
    expect(slot.getByText("Unsorted idea")).toBeTruthy();
    expect(slot.queryByText("Dark mode")).toBeNull();
  });

  it("says so when no issue is blocked", async () => {
    const slot = await renderPage();
    await slot.findByText("Crash on save");

    fireEvent.click(slot.getByRole("radio", { name: "Show blocked issues" }));

    expect(slot.getByText("No issue is blocked by another issue.")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Show all" }));
    expect(slot.getByText("Crash on save")).toBeTruthy();
  });

  it("draws an arrow from the blocking card to the blocked card", async () => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const issueNumber = Number((this as HTMLElement).dataset?.issueNumber);
      if (!issueNumber) return DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 1000 });
      return DOMRect.fromRect({ x: issueNumber * 320, y: 20, width: 300, height: 80 });
    });
    const slot = await renderPage({ rpc: { issues_get_board: () => dependencyBoard() } });
    await slot.findByText("Crash on save");

    const arrows = await slot.findByTestId("dependency-arrows");
    expect(arrows.querySelectorAll("path[d]").length).toBe(2); // the marker head and one arrow
  });

  it("filters by value chips in the filter bar", async () => {
    const slot = await renderPage();
    await slot.findByText("Crash on save");

    fireEvent.click(slot.getByRole("button", { name: "Filter by value 8" }));

    expect(slot.getByText("Dark mode")).toBeTruthy();
    expect(slot.queryByText("Crash on save")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Clear value filter" }));
    expect(slot.getByText("Crash on save")).toBeTruthy();
  });

  it("filters by whether an issue has a linked thread", async () => {
    const slot = await renderPage({
      rpc: {
        issues_get_board: () => boardResponse({ threadLinks: { "1": { threadId: "thr_1", title: null } } }),
      },
    });
    await slot.findByText("Crash on save");

    fireEvent.click(slot.getByRole("radio", { name: "Issues with a linked thread" }));
    expect(slot.getByText("Crash on save")).toBeTruthy();
    expect(slot.queryByText("Dark mode")).toBeNull();

    fireEvent.click(slot.getByRole("radio", { name: "Issues without a linked thread" }));
    expect(slot.queryByText("Crash on save")).toBeNull();
    expect(slot.getByText("Dark mode")).toBeTruthy();
  });

  it("keeps a project's filters when switching away and back", async () => {
    const slot = await renderPage();
    await slot.findByText("Crash on save");
    fireEvent.click(slot.getByRole("button", { name: "Filter by value 8" }));
    cleanup();

    const again = await renderPage();
    await again.findByText("Dark mode");
    expect(again.queryByText("Crash on save")).toBeNull();
    expect(again.getByRole("button", { name: "Filter by value 8" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("collapses a column and saves the choice", async () => {
    const slot = await renderPage({ rpc: { issues_get_collapsed_columns: () => ["feature"] } });
    const bug = await slot.findByRole("region", { name: "bug" });
    await waitFor(() => expect(slot.queryByText("Dark mode")).toBeNull());

    fireEvent.click(within(bug).getByRole("button", { name: "Collapse bug" }));

    expect(slot.queryByText("Crash on save")).toBeNull();
    expect(within(bug).getByText("1")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "issues_set_collapsed_columns",
        input: { projectId: "proj_1", labels: ["feature", "bug"] },
      }),
    );
  });

  it("opens the new thread screen from the card's Start button", async () => {
    const slot = await renderPage();
    const bug = await slot.findByRole("region", { name: "bug" });
    await slot.behavior.setComposerText("Write this first");

    fireEvent.click(within(bug).getByRole("button", { name: "Open a new thread for this issue" }));

    const prompt = "https://github.com/acme/repo/issues/1\n";
    expect(slot.inspection.composer.text).toBe(prompt);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "toCompose",
      options: { projectId: "proj_1", initialPrompt: prompt, focusPrompt: true },
    });
  });
});
