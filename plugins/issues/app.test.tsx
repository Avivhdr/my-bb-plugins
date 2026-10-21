// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

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
        ...options.rpc,
      },
    },
  );
  return slot;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

  it("starts a thread from an issue and opens it", async () => {
    const slot = await renderPage({
      rpc: { issues_start_thread: () => ({ threadId: "thr_9" }) },
    });
    const bug = await slot.findByRole("region", { name: "bug" });

    fireEvent.click(within(bug).getByText("Crash on save"));
    const dialog = await slot.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Start thread/ }));

    await waitFor(() =>
      expect(slot.inspection.navigateCalls).toContainEqual(
        expect.objectContaining({ method: "toThread", threadId: "thr_9" }),
      ),
    );
    expect(slot.inspection.rpcCalls).toContainEqual(
      expect.objectContaining({
        method: "issues_start_thread",
        input: { projectId: "proj_1", issueNumber: 1, title: "Crash on save" },
      }),
    );
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
});
