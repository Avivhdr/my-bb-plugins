// @vitest-environment jsdom
import { cleanup } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot, type CapturedPluginApp } from "@get-bb/plugin-sdk/testing/app";
import type { DashboardResult } from "../spendService";
import { buildAttributionMap } from "../attribution";
import { buildDashboard } from "../dashboard";
import { emptySpendIndex, indexTranscript, mergeTranscript } from "../spendIndex";
import type { BilledResponse } from "../transcript";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");

const map = buildAttributionMap({
  projects: [{ id: "P-1", name: "frontend", paths: ["/code/frontend"] }],
  environments: [{ id: "E-1", projectId: "P-1", path: "/worktrees/thr_1" }],
  threads: [{ id: "thr_1", title: "Fix the panel", projectId: "P-1", environmentId: "E-1", providerId: "claude-code" }],
});

function response(overrides: Partial<BilledResponse> = {}): BilledResponse {
  return {
    messageId: "msg_1",
    model: "claude-opus-5",
    timestamp: NOW,
    cwd: "/worktrees/thr_1",
    tokens: { input: 0, output: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    ...overrides,
  };
}

function dashboardOf(responses: BilledResponse[], indexing = false): DashboardResult {
  const index = emptySpendIndex();
  responses.forEach((entry, position) => {
    mergeTranscript(index, `${position}.jsonl`, indexTranscript([entry], { sizeBytes: 1, modifiedAt: 1 }));
  });
  return { ...buildDashboard(index, map, NOW), indexing };
}

let app: CapturedPluginApp;

beforeAll(async () => {
  app = await loadPluginApp(() => import("../../app"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderDashboard(dashboard: () => DashboardResult | Promise<DashboardResult>, rescan = vi.fn(() => ({}))) {
  return renderSlot(app.navPanels[0]!, { subPath: "" }, { rpc: { dashboard, rescan } });
}

describe("Claude usage page", () => {
  it("shows a loading state until the first figures arrive", async () => {
    const slot = renderDashboard(() => new Promise<DashboardResult>(() => {}));

    expect(await slot.findByText("Loading usage…")).toBeTruthy();
  });

  it("shows an indexing state while the first scan runs", async () => {
    const slot = renderDashboard(() => dashboardOf([], true));

    expect(await slot.findByText("Reading Claude Code transcripts for the first time…")).toBeTruthy();
  });

  it("shows an empty state when no transcripts exist", async () => {
    const slot = renderDashboard(() => dashboardOf([]));

    expect(await slot.findByText(/No Claude Code transcripts found/)).toBeTruthy();
  });

  it("shows totals, the chart, and the project, thread, and model breakdowns", async () => {
    const slot = renderDashboard(() => dashboardOf([response(), response({ cwd: "/elsewhere" })]));

    expect(await slot.findByText("Last 30 days")).toBeTruthy();
    expect(slot.getAllByText("$50.00").length).toBeGreaterThan(0);
    expect(slot.getByLabelText("Daily spend from Jul 29 to Aug 27")).toBeTruthy();
    expect(slot.getAllByText("frontend")).toHaveLength(2);
    expect(slot.getByText("Outside BB")).toBeTruthy();
    expect(slot.getByText("Fix the panel")).toBeTruthy();
    expect(slot.getByText("claude-opus-5")).toBeTruthy();
    expect(slot.getByText(/Every figure is a lower bound/)).toBeTruthy();
  });

  it("pages the daily chart back and forward one 30-day window at a time", async () => {
    const old = response({ messageId: "msg_2", timestamp: NOW - 45 * 24 * 60 * 60 * 1000 });
    const slot = renderDashboard(() => dashboardOf([old, response()]));
    const older = await slot.findByRole("button", { name: "Previous 30 days" });
    const newer = slot.getByRole("button", { name: "Next 30 days" });
    expect(slot.getByText("Jul 29 to Aug 27")).toBeTruthy();
    expect(newer.hasAttribute("disabled")).toBe(true);

    await act(async () => older.click());

    expect(slot.getByText("Jun 29 to Jul 28")).toBeTruthy();
    expect(older.hasAttribute("disabled")).toBe(true);
    expect(newer.hasAttribute("disabled")).toBe(false);

    await act(async () => newer.click());

    expect(slot.getByText("Jul 29 to Aug 27")).toBeTruthy();
  });

  it("names an unpriced model in a banner", async () => {
    const slot = renderDashboard(() => dashboardOf([response(), response({ model: "claude-unreleased-9" })]));

    expect((await slot.findByRole("alert")).textContent).toContain("claude-unreleased-9");
  });

  it("rescans on request and shows the refreshed figures", async () => {
    let total = 1;
    const rescan = vi.fn(() => {
      total = 2;
      return { transcriptsSeen: 2, transcriptsRead: 1, transcriptsFailed: 0 };
    });
    const slot = renderDashboard(() => dashboardOf(Array.from({ length: total }, () => response())), rescan);
    await slot.findByText("Last 30 days");

    await act(async () => slot.getByRole("button", { name: "Rescan transcripts" }).click());

    expect(rescan).toHaveBeenCalledTimes(1);
    expect(await slot.findByText("2 transcripts indexed", { exact: false })).toBeTruthy();
  });

  it("shows why figures cannot be read", async () => {
    const slot = renderDashboard(() => {
      throw new Error("database locked");
    });

    expect((await slot.findByRole("alert")).textContent).toContain("database locked");
  });

  it("re-reads the figures every minute while open", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const dashboard = vi.fn(() => dashboardOf([response()]));
    const slot = renderDashboard(dashboard);
    await slot.findByText("Last 30 days");

    await act(async () => vi.advanceTimersByTime(60_000));

    expect(dashboard).toHaveBeenCalledTimes(2);
  });
});

describe("sidebar row", () => {
  const accessory = () => ({ component: app.navPanels[0]!.experimental_sidebarAccessory! });

  it("shows today's spend, not earlier days", async () => {
    const threeDaysAgo = response({ messageId: "msg_2", timestamp: NOW - 3 * 24 * 60 * 60 * 1000 });
    const slot = renderSlot(accessory(), {}, {
      rpc: { dashboard: () => dashboardOf([response(), threeDaysAgo]) },
    });

    expect(await slot.findByText("$25.00")).toBeTruthy();
    expect(slot.queryByText("$50.00")).toBeNull();
  });

  it("shows nothing while the first scan runs", async () => {
    const dashboard = vi.fn(() => dashboardOf([], true));
    const slot = renderSlot(accessory(), {}, { rpc: { dashboard } });
    await vi.waitFor(() => expect(dashboard).toHaveBeenCalled());

    expect(slot.container.textContent).toBe("");
  });
});

describe("thread header", () => {
  const props = { threadId: "thr_1", projectId: "P-1", isCompactViewport: false };

  it("shows nothing while the figure loads", () => {
    const slot = renderSlot(app.threadHeaderActions[0]!, props, {
      rpc: { threadSpend: () => new Promise(() => {}) },
    });

    expect(slot.container.textContent).toBe("");
  });

  it("says no spend is recorded rather than showing an amount", async () => {
    const slot = renderSlot(app.threadHeaderActions[0]!, props, {
      rpc: { threadSpend: () => ({ threadId: "thr_1", found: false, total: 0 }) },
    });

    expect(await slot.findByText("No spend recorded")).toBeTruthy();
  });

  it("shows the thread's spend, including a zero that was recorded", async () => {
    const slot = renderSlot(app.threadHeaderActions[0]!, props, {
      rpc: { threadSpend: () => ({ threadId: "thr_1", found: true, total: 0 }) },
    });

    expect(await slot.findByText("$0.00")).toBeTruthy();
  });
});
