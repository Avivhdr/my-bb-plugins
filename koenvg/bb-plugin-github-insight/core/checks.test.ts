import { describe, expect, it } from "vitest";
import {
  failingCheckRunIds,
  latestCheckCandidates,
  mapCheckRunStatus,
  markWaitingStatuses,
  QUIET_STATUS_MS,
  mapStatusContextState,
  toCheck,
  type CheckNode,
  type CheckRunNode,
  type StatusContextNode,
} from "./checks";

function checkRun(overrides: Partial<CheckRunNode> = {}): CheckRunNode {
  return {
    __typename: "CheckRun",
    id: "CR_1",
    databaseId: 1,
    name: "build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: "https://github.com/o/r/actions/runs/1/job/1",
    startedAt: "2026-09-24T10:00:00Z",
    title: null,
    summary: null,
    isRequired: false,
    ...overrides,
  };
}

function statusContext(overrides: Partial<StatusContextNode> = {}): StatusContextNode {
  return {
    __typename: "StatusContext",
    context: "Storybook Publish",
    state: "SUCCESS",
    description: null,
    targetUrl: "https://example.com/storybook",
    createdAt: "2026-09-24T10:00:00Z",
    isRequired: false,
    ...overrides,
  };
}

describe("mapCheckRunStatus", () => {
  it.each([
    ["FAILURE", "failed"],
    ["TIMED_OUT", "failed"],
    ["ACTION_REQUIRED", "failed"],
    ["STARTUP_FAILURE", "failed"],
    ["CANCELLED", "cancelled"],
    ["STALE", "cancelled"],
    ["SUCCESS", "passed"],
    ["SKIPPED", "skipped"],
    ["NEUTRAL", "skipped"],
  ] as const)("maps completed conclusion %s to %s", (conclusion, expected) => {
    expect(mapCheckRunStatus("COMPLETED", conclusion)).toBe(expected);
  });

  it.each(["QUEUED", "IN_PROGRESS", "WAITING", "PENDING", "REQUESTED"] as const)(
    "maps status %s without a conclusion to running",
    (status) => {
      expect(mapCheckRunStatus(status, null)).toBe("running");
    },
  );
});

describe("mapStatusContextState", () => {
  it.each([
    ["ERROR", "failed"],
    ["FAILURE", "failed"],
    ["PENDING", "running"],
    ["EXPECTED", "running"],
    ["SUCCESS", "passed"],
  ] as const)("maps state %s to %s", (state, expected) => {
    expect(mapStatusContextState(state)).toBe(expected);
  });
});

function buildChecks(nodes: readonly CheckNode[]) {
  return latestCheckCandidates(nodes).map((candidate) => toCheck(candidate, new Map()));
}

const threeNodeOrders = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
] as const;

describe("latestCheckCandidates", () => {
  it("shows a check re-run after a cancel once, as passed", () => {
    const checks = buildChecks([
      checkRun({
        databaseId: 1,
        name: "renovate-gate",
        conclusion: "CANCELLED",
        startedAt: "2026-09-24T10:00:00Z",
      }),
      checkRun({
        databaseId: 2,
        name: "renovate-gate",
        conclusion: "SUCCESS",
        startedAt: "2026-09-24T10:05:00Z",
        detailsUrl: "https://github.com/o/r/actions/runs/2/job/2",
      }),
    ]);

    expect(checks).toMatchObject([
      {
        name: "renovate-gate",
        status: "passed",
        url: "https://github.com/o/r/actions/runs/2/job/2",
      },
    ]);
  });

  it("breaks a startedAt tie by the higher databaseId", () => {
    const checks = buildChecks([
      checkRun({ databaseId: 9, conclusion: "FAILURE" }),
      checkRun({ databaseId: 3, conclusion: "SUCCESS" }),
    ]);

    expect(checks.map((check) => check.status)).toEqual(["failed"]);
  });

  it("treats a queued re-run without startedAt as the newest run", () => {
    const checks = buildChecks([
      checkRun({ databaseId: 1, conclusion: "FAILURE" }),
      checkRun({
        databaseId: 2,
        status: "QUEUED",
        conclusion: null,
        startedAt: null,
      }),
    ]);

    expect(checks.map((check) => check.status)).toEqual(["running"]);
  });

  describe.each([
    { queuedId: 1, completedId: 2, runId: "completed", status: "passed", required: true },
    { queuedId: 2, completedId: 1, runId: "queued", status: "running", required: false },
  ] as const)("queued attempt $queuedId versus completed attempt $completedId", (expected) => {
    it.each([false, true])("selects the newest attempt with reversed input %s", (reverse) => {
      const nodes = [
        checkRun({
          id: "queued",
          databaseId: expected.queuedId,
          name: "Tests",
          status: "QUEUED",
          conclusion: null,
          startedAt: null,
          detailsUrl: "https://github.com/o/r/actions/runs/queued",
        }),
        checkRun({
          id: "completed",
          databaseId: expected.completedId,
          name: "Tests",
          startedAt: "2026-10-15T12:00:00Z",
          detailsUrl: "https://github.com/o/r/actions/runs/completed",
          isRequired: true,
        }),
      ];
      const candidates = latestCheckCandidates(reverse ? nodes.slice().reverse() : nodes);

      expect(candidates.map((candidate) => candidate.runId)).toEqual([expected.runId]);
      expect(candidates.map((candidate) => toCheck(candidate, new Map()))).toEqual([
        {
          name: "Tests",
          status: expected.status,
          url: `https://github.com/o/r/actions/runs/${expected.runId}`,
          required: expected.required,
          failure: null,
        },
      ]);
    });
  });

  it.each(threeNodeOrders)(
    "selects the latest failure regardless of execution order in permutation %s %s %s",
    (first, second, third) => {
      const attempts = [
        checkRun({
          id: "old-cancelled",
          databaseId: 1,
          conclusion: "CANCELLED",
          startedAt: "2026-10-15T12:10:00Z",
        }),
        checkRun({
          id: "queued",
          databaseId: 2,
          status: "QUEUED",
          conclusion: null,
          startedAt: null,
        }),
        checkRun({
          id: "latest-failed",
          databaseId: 3,
          conclusion: "FAILURE",
          startedAt: "2026-10-15T12:00:00Z",
          detailsUrl: "https://github.com/o/r/actions/runs/3/job/3",
          isRequired: true,
        }),
      ];
      const candidates = latestCheckCandidates([
        attempts[first]!,
        attempts[second]!,
        attempts[third]!,
      ]);
      const annotations = new Map([
        ["old-cancelled", [{ path: "old.ts", line: 1, message: "old failure" }]],
        ["latest-failed", [{ path: "latest.ts", line: 3, message: "latest failure" }]],
      ]);

      expect(candidates.map((candidate) => candidate.runId)).toEqual(["latest-failed"]);
      expect(failingCheckRunIds(candidates)).toEqual(["latest-failed"]);
      expect(candidates.map((candidate) => toCheck(candidate, annotations))).toEqual([
        {
          name: "build",
          status: "failed",
          url: "https://github.com/o/r/actions/runs/3/job/3",
          required: true,
          failure: {
            reason: "latest failure",
            annotations: [{ path: "latest.ts", line: 3, message: "latest failure" }],
            annotationCount: 1,
          },
        },
      ]);
    },
  );

  describe.each([
    { queuedId: 1, completedId: 2, runId: null, status: "failed", required: true },
    { queuedId: 2, completedId: 1, runId: "queued", status: "running", required: false },
  ] as const)("same-name status context with queued attempt $queuedId", (expected) => {
    it.each(threeNodeOrders)(
      "compares source winners by recency in permutation %s %s %s",
      (first, second, third) => {
        const nodes = [
          checkRun({
            id: "queued",
            databaseId: expected.queuedId,
            status: "QUEUED",
            conclusion: null,
            startedAt: null,
            detailsUrl: "https://github.com/o/r/actions/runs/queued",
          }),
          checkRun({
            id: "completed",
            databaseId: expected.completedId,
            startedAt: "2026-10-15T12:00:00Z",
          }),
          statusContext({
            context: "build",
            state: "FAILURE",
            createdAt: "2026-10-15T13:00:00Z",
            description: "status failure",
            isRequired: true,
          }),
        ];
        const candidates = latestCheckCandidates([nodes[first]!, nodes[second]!, nodes[third]!]);

        expect(candidates.map((candidate) => candidate.runId)).toEqual([expected.runId]);
        expect(candidates.map((candidate) => toCheck(candidate, new Map()))).toEqual([
          {
            name: "build",
            status: expected.status,
            url:
              expected.runId === null
                ? "https://example.com/storybook"
                : "https://github.com/o/r/actions/runs/queued",
            required: expected.required,
            failure:
              expected.runId === null
                ? { reason: "status failure", annotations: [], annotationCount: 0 }
                : null,
          },
        ]);
      },
    );
  });

  it("keeps the newest status context by createdAt", () => {
    const checks = buildChecks([
      statusContext({ state: "SUCCESS", createdAt: "2026-09-24T11:00:00Z" }),
      statusContext({ state: "PENDING", createdAt: "2026-09-24T10:00:00Z" }),
    ]);

    expect(checks).toMatchObject([
      {
        name: "Storybook Publish",
        status: "passed",
        url: "https://example.com/storybook",
      },
    ]);
  });

  it("gives a null url when GitHub has no link", () => {
    const [check] = buildChecks([checkRun({ detailsUrl: null })]);

    expect(check?.url).toBeNull();
  });
});

describe("toCheck", () => {
  it("gives a failed status context its description as reason", () => {
    const [check] = buildChecks([
      statusContext({ state: "ERROR", description: "Storybook build failed" }),
    ]);

    expect(check?.failure).toEqual({
      reason: "Storybook build failed",
      annotations: [],
      annotationCount: 0,
    });
  });

  it("gives a failed check run the annotations of its run", () => {
    const [candidate] = latestCheckCandidates([checkRun({ id: "CR_9", conclusion: "FAILURE" })]);
    const annotation = { path: "src/a.ts", line: 3, message: "boom" };

    const check = toCheck(candidate!, new Map([["CR_9", [annotation]]]));

    expect(check.failure).toEqual({
      reason: "boom",
      annotations: [annotation],
      annotationCount: 1,
    });
  });

  it("keeps the link of a failed check without reason text", () => {
    const [check] = buildChecks([checkRun({ conclusion: "FAILURE" })]);

    expect(check?.failure?.reason).toBe("");
    expect(check?.url).toBe("https://github.com/o/r/actions/runs/1/job/1");
  });

  it("gives no failure detail to a check that did not fail", () => {
    const [check] = buildChecks([checkRun({ conclusion: "SUCCESS" })]);

    expect(check?.failure).toBeNull();
  });
});

describe("failingCheckRunIds", () => {
  it("lists only the failed and cancelled check runs", () => {
    const ids = failingCheckRunIds(
      latestCheckCandidates([
        checkRun({ id: "CR_failed", name: "a", conclusion: "FAILURE" }),
        checkRun({ id: "CR_cancelled", name: "b", conclusion: "CANCELLED" }),
        checkRun({ id: "CR_passed", name: "c", conclusion: "SUCCESS" }),
        statusContext({ state: "FAILURE" }),
      ]),
    );

    expect(ids).toEqual(["CR_failed", "CR_cancelled"]);
  });
});

describe("markWaitingStatuses", () => {
  const pendingSince = "2026-09-24T10:00:00Z";
  const quietFor = (ms: number) => Date.parse(pendingSince) + ms;
  const uiReview = statusContext({
    context: "UI Review",
    state: "PENDING",
    createdAt: pendingSince,
  });
  const statusOf = (nodes: readonly CheckNode[], now: number, name: string) =>
    markWaitingStatuses(latestCheckCandidates(nodes), now).find((c) => c.name === name)?.status;

  it("marks a pending status as waiting once it is quiet and every check run is done", () => {
    expect(statusOf([checkRun(), uiReview], quietFor(5 * 60_000), "UI Review")).toBe("waiting");
  });

  it("marks a pending status as waiting exactly at the quiet threshold", () => {
    expect(statusOf([uiReview], quietFor(QUIET_STATUS_MS), "UI Review")).toBe("waiting");
  });

  it("keeps a recently updated pending status running", () => {
    expect(statusOf([checkRun(), uiReview], quietFor(60_000), "UI Review")).toBe("running");
  });

  it("keeps a quiet pending status running while a check run is running", () => {
    const build = checkRun({ status: "IN_PROGRESS", conclusion: null });
    expect(statusOf([build, uiReview], quietFor(20 * 60_000), "UI Review")).toBe("running");
  });

  it("never marks a check run as waiting", () => {
    const e2e = checkRun({ name: "e2e", status: "QUEUED", conclusion: null, startedAt: null });
    expect(statusOf([e2e], quietFor(30 * 60_000), "e2e")).toBe("running");
  });

  it("leaves finished statuses alone", () => {
    const published = statusContext({ createdAt: pendingSince });
    expect(statusOf([published], quietFor(30 * 60_000), "Storybook Publish")).toBe("passed");
  });
});
