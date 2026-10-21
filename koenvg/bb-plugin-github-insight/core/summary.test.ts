import { describe, expect, it } from "vitest";
import pageOne from "../test/fixtures/pr-25337-overview-page-1.json";
import pageTwo from "../test/fixtures/pr-25337-overview-page-2.json";
import checkRunDetails from "../test/fixtures/pr-25337-check-run-details.json";
import type { Check } from "./checks";
import { collectInsight, type PrInsight } from "./overview";
import type { Reviewer } from "./reviewers";
import {
  buildSummary,
  MAX_SUMMARY_BYTES,
  SUMMARY_HEARTBEAT_MS,
  shouldWriteSummary,
  type PrSummary,
} from "./summary";

const recordedPages: Record<string, unknown> = { start: pageOne, MTAw: pageTwo };
const refreshedAt = Date.parse("2026-09-24T10:00:00Z");

async function recordedInsight(): Promise<PrInsight> {
  const { insight } = await collectInsight({
    fetchOverviewPage: async (after) => recordedPages[after ?? "start"],
    fetchCheckRunDetails: async () => checkRunDetails,
  });
  return insight;
}

function check(name: string, status: Check["status"]): Check {
  return { name, status, url: null, required: false, failure: null };
}

function reviewer(name: string, overrides: Partial<Reviewer> = {}): Reviewer {
  return { name, kind: "user", state: "pending", codeOwner: false, ...overrides };
}

function insight(overrides: Partial<PrInsight> = {}): PrInsight {
  return {
    pr: {
      number: 1,
      title: "t",
      state: "open",
      url: "https://github.com/o/r/pull/1",
      headOid: "abc",
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
    blockers: [],
    reviewers: [],
    checks: [],
    mergeQueue: null,
    autoMergeAction: { kind: "none" },
    canUpdateBranch: false,
    ...overrides,
  };
}

describe("buildSummary on PR 25337", () => {
  it("gives the version 1 summary with counts, names, and blocker codes", async () => {
    const summary = buildSummary({
      insight: await recordedInsight(),
      refreshedAt,
      error: null,
    });

    expect(summary).toMatchInlineSnapshot(`
      {
        "blockers": [
          "checks_failed",
          "behind",
          "review_required",
        ],
        "checks": {
          "cancelled": 1,
          "failed": 1,
          "failedNames": [
            "trigger-testing / a11y-test (1) / a11y-test",
          ],
          "passed": 98,
          "running": 0,
          "skipped": 8,
          "waiting": 0,
        },
        "error": null,
        "mergeQueue": null,
        "pr": {
          "number": 25337,
          "state": "open",
          "url": "https://github.com/collibra/frontend/pull/25337",
        },
        "reviewers": {
          "approved": 5,
          "changesRequested": 0,
          "pending": 6,
          "pendingNames": [
            "workflows-frontend (team)",
            "semantic-model-ontology-frontend (team)",
            "knowledge-graph-model-frontend (team)",
            "control-tower-frontend (team)",
            "catalog-integrations (team)",
          ],
        },
        "updatedAt": "2026-09-24T10:00:00.000Z",
        "version": 1,
      }
    `);
  });

  it("stays under 4 KiB and holds no annotation text", async () => {
    const recorded = await recordedInsight();
    const json = JSON.stringify(buildSummary({ insight: recorded, refreshedAt, error: null }));

    expect(new TextEncoder().encode(json).length).toBeLessThan(MAX_SUMMARY_BYTES);
    const failureTexts = recorded.checks
      .flatMap((candidate) =>
        candidate.failure === null
          ? []
          : [candidate.failure.reason, ...candidate.failure.annotations.map((a) => a.message)],
      )
      .filter((text) => text !== "");
    expect(failureTexts.length).toBeGreaterThan(0);
    for (const text of failureTexts) expect(json).not.toContain(text);
  });
});

describe("buildSummary", () => {
  it("keeps the first 5 failed check names", () => {
    const checks = [1, 2, 3, 4, 5, 6].map((index) => check(`check ${index}`, "failed"));

    const summary = buildSummary({ insight: insight({ checks }), refreshedAt, error: null });

    expect(summary.checks.failed).toBe(6);
    expect(summary.checks.failedNames).toEqual([
      "check 1",
      "check 2",
      "check 3",
      "check 4",
      "check 5",
    ]);
  });

  it("counts waiting checks apart from running checks and keeps the blocker code", () => {
    const summary = buildSummary({
      insight: insight({
        checks: [check("UI Review", "waiting"), check("lint", "passed")],
        blockers: [{ code: "checks_waiting", text: "UI Review waiting for you" }],
      }),
      refreshedAt,
      error: null,
    });

    expect(summary.version).toBe(1);
    expect(summary.checks.waiting).toBe(1);
    expect(summary.checks.running).toBe(0);
    expect(summary.blockers).toEqual(["checks_waiting"]);
  });

  it("marks pending teams and counts reviewers by state", () => {
    const reviewers = [
      reviewer("ai-governance", { kind: "team", codeOwner: true }),
      reviewer("alice"),
      reviewer("bob", { state: "approved" }),
      reviewer("carol", { state: "changes_requested" }),
      reviewer("dave", { state: "commented" }),
    ];

    const summary = buildSummary({ insight: insight({ reviewers }), refreshedAt, error: null });

    expect(summary.reviewers).toEqual({
      pending: 2,
      approved: 1,
      changesRequested: 1,
      pendingNames: ["ai-governance (team)", "alice"],
    });
  });

  it.each([
    ["ASCII", "x"],
    ["multi-byte", "日"],
    ["escaped", '"\\\u0001'],
  ])("shortens long %s names so the summary stays under 4 KiB", (_, unit) => {
    const long = unit.repeat(1000);
    const checks = [1, 2, 3, 4, 5].map((index) => check(`${index}${long}`, "failed"));
    const reviewers = [1, 2, 3, 4, 5].map((index) => reviewer(`${index}${long}`));

    const summary = buildSummary({
      insight: insight({ checks, reviewers }),
      refreshedAt,
      error: long,
    });

    expect(new TextEncoder().encode(JSON.stringify(summary)).length).toBeLessThan(
      MAX_SUMMARY_BYTES,
    );
  });

  it("gives the queue entry and no blockers for a queued PR", () => {
    const summary = buildSummary({
      insight: insight({ mergeQueue: { position: 2, state: "queued" } }),
      refreshedAt,
      error: null,
    });

    expect(summary).toMatchObject({
      version: 1,
      mergeQueue: { position: 2, state: "queued" },
      blockers: [],
    });
  });

  it("gives a null queue entry for a PR not in a queue", () => {
    expect(buildSummary({ insight: insight(), refreshedAt, error: null }).mergeQueue).toBeNull();
  });

  it("keeps the time of the last good refresh and the error", () => {
    const summary = buildSummary({ insight: insight(), refreshedAt, error: "rate limited" });

    expect(summary).toMatchObject({ updatedAt: "2026-09-24T10:00:00.000Z", error: "rate limited" });
  });
});

describe("shouldWriteSummary", () => {
  const written = buildSummary({ insight: insight(), refreshedAt, error: null });
  const later = (ms: number) => refreshedAt + ms;
  const refreshedLater = (ms: number): PrSummary => ({
    ...written,
    updatedAt: new Date(later(ms)).toISOString(),
  });

  it("writes a summary the thread does not have yet", () => {
    expect(shouldWriteSummary(undefined, written, refreshedAt)).toBe(true);
  });

  it("skips a summary with the same data and a recent write", () => {
    expect(
      shouldWriteSummary(
        { summary: written, writtenAt: refreshedAt },
        refreshedLater(60_000),
        later(60_000),
      ),
    ).toBe(false);
  });

  it("writes when the data changed", () => {
    const next = { ...written, error: "rate limited" };

    expect(shouldWriteSummary({ summary: written, writtenAt: refreshedAt }, next, later(1))).toBe(
      true,
    );
  });

  it("writes a newer refresh time once the last write is 30 minutes old", () => {
    const next = refreshedLater(SUMMARY_HEARTBEAT_MS);

    expect(
      shouldWriteSummary(
        { summary: written, writtenAt: refreshedAt },
        next,
        later(SUMMARY_HEARTBEAT_MS),
      ),
    ).toBe(true);
  });

  it("does not rewrite the same failed-refresh summary", () => {
    const failing = { ...written, error: "rate limited" };

    expect(
      shouldWriteSummary(
        { summary: failing, writtenAt: refreshedAt },
        failing,
        later(2 * SUMMARY_HEARTBEAT_MS),
      ),
    ).toBe(false);
  });
});
