import { describe, expect, it } from "vitest";
import pageOne from "../test/fixtures/pr-25337-overview-page-1.json";
import pageTwo from "../test/fixtures/pr-25337-overview-page-2.json";
import checkRunDetails from "../test/fixtures/pr-25337-check-run-details.json";
import readyToEnqueuePage from "../test/fixtures/pr-25693-overview-ready-to-enqueue.json";
import inMergeQueuePage from "../test/fixtures/pr-25597-overview-in-merge-queue.json";
import requiredChecksPage from "../test/fixtures/pr-cli-14583-overview-required-checks.json";
import { MAX_CONTEXT_PAGES, collectInsight, type GitHubReader } from "./overview";

const recordedPages: Record<string, unknown> = { start: pageOne, MTAw: pageTwo };

function recordedGitHub(overrides: Partial<GitHubReader> = {}): GitHubReader {
  return {
    fetchOverviewPage: async (after) => recordedPages[after ?? "start"],
    fetchCheckRunDetails: async () => checkRunDetails,
    ...overrides,
  };
}

function onlyPassingChecksPage(extraNodes: readonly unknown[] = []) {
  return {
    data: {
      repository: {
        ...pageOne.data.repository,
        pullRequest: {
          ...pageOne.data.repository.pullRequest,
          commits: {
            nodes: [
              {
                commit: {
                  statusCheckRollup: {
                    contexts: {
                      pageInfo: { hasNextPage: false, endCursor: null },
                      nodes: [
                        ...pageOne.data.repository.pullRequest.commits.nodes[0]!.commit.statusCheckRollup.contexts.nodes.filter(
                          (node) => node.conclusion === "SUCCESS",
                        ),
                        ...extraNodes,
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    },
  };
}

function queuedPage(mergeQueueEntry: { position: number; state: string }) {
  return {
    data: {
      repository: {
        ...pageOne.data.repository,
        pullRequest: {
          ...pageOne.data.repository.pullRequest,
          mergeStateStatus: "BLOCKED",
          mergeQueueEntry,
        },
      },
    },
  };
}

function queuedGitHub(state: string, position = 3): GitHubReader {
  return recordedGitHub({
    fetchOverviewPage: async (after) =>
      after === null ? queuedPage({ position, state }) : recordedPages[after],
  });
}

describe("collectInsight on PR 25337", () => {
  it("gives the PR header", async () => {
    const { insight } = await collectInsight(recordedGitHub());

    expect(insight.pr).toEqual({
      number: 25337,
      title: "feat(*): add ootbDomainTypesIds constants and replace hardcoded domain type UUIDs",
      state: "open",
      url: "https://github.com/collibra/frontend/pull/25337",
      headOid: "2c850077d3529aa67c8178c80d09517377124ea9",
      headRefName: "feat/ootb-domain-type-ids",
      headOwner: null,
      isCrossRepository: false,
      baseRefName: "master",
      author: "koenvg",
      additions: 120,
      deletions: 30,
      changedFiles: 12,
    });
  });

  it("keeps the PR node id out of the insight", async () => {
    const reading = await collectInsight(recordedGitHub());

    expect(reading.pullRequestId).toBe("PR_kwDOHI7l-88AAAABEiddXg");
    expect(JSON.stringify(reading.insight)).not.toContain("PR_kwDOHI7l-88AAAABEiddXg");
  });

  it("offers no merge on a PR with blockers", async () => {
    const { insight } = await collectInsight(recordedGitHub());

    expect(insight.mergeAction).toEqual({ kind: "none" });
  });

  it("gives one check per name across both pages", async () => {
    const { insight } = await collectInsight(recordedGitHub());
    const names = insight.checks.map((check) => check.name);

    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Storybook Publish");
  });

  it("shows re-runs after a cancel as passed", async () => {
    const { insight } = await collectInsight(recordedGitHub());
    const build = insight.checks.find((check) => check.name === "trigger-testing / build / build");

    expect(build?.status).toBe("passed");
  });

  it("counts the newest run of every check by status", async () => {
    const { insight } = await collectInsight(recordedGitHub());
    const counts: Record<string, number> = {};
    for (const check of insight.checks) {
      counts[check.status] = (counts[check.status] ?? 0) + 1;
    }

    expect(counts).toMatchInlineSnapshot(`
      {
        "cancelled": 1,
        "failed": 1,
        "passed": 98,
        "skipped": 8,
      }
    `);
  });

  it("asks annotations only for the newest failed and cancelled check runs", async () => {
    const requested: string[][] = [];

    await collectInsight(
      recordedGitHub({
        fetchCheckRunDetails: async (ids) => {
          requested.push(ids);
          return checkRunDetails;
        },
      }),
    );

    expect(requested).toEqual([["CR_kwDOHI7l-88AAAAZCnAPSQ", "CR_kwDOHI7l-88AAAAZCnoC7g"]]);
  });

  it("gives the failed Actions check its annotation as reason", async () => {
    const { insight } = await collectInsight(recordedGitHub());
    const a11y = insight.checks.find(
      (check) => check.name === "trigger-testing / a11y-test (1) / a11y-test",
    );

    expect(a11y).toEqual({
      name: "trigger-testing / a11y-test (1) / a11y-test",
      status: "failed",
      url: "https://github.com/collibra/frontend/actions/runs/35973768789/job/107549950702",
      required: false,
      failure: {
        reason: "Process completed with exit code 1.",
        annotations: [
          { path: ".github", line: 4092, message: "Process completed with exit code 1." },
        ],
        annotationCount: 1,
      },
    });
  });

  it("keeps the link of a cancelled check without reason text", async () => {
    const { insight } = await collectInsight(recordedGitHub());
    const e2e = insight.checks.find((check) => check.name === "run-e2e-tests-v4");

    expect(e2e).toMatchObject({
      status: "cancelled",
      url: expect.stringContaining("/job/107549298505"),
      failure: { reason: "", annotations: [], annotationCount: 0 },
    });
  });

  it("lists the pending code owner teams before the approvals", async () => {
    const { insight } = await collectInsight(recordedGitHub());

    expect(insight.reviewers.slice(0, 2)).toEqual([
      { name: "workflows-frontend", kind: "team", state: "pending", codeOwner: true },
      {
        name: "semantic-model-ontology-frontend",
        kind: "team",
        state: "pending",
        codeOwner: true,
      },
    ]);
    expect(insight.reviewers).toContainEqual({
      name: "koenvangeert",
      kind: "user",
      state: "approved",
      codeOwner: false,
    });
    expect(insight.reviewers).toHaveLength(11);
  });

  it("gives the merge blockers of a branch that is behind and needs review", async () => {
    const { insight } = await collectInsight(recordedGitHub());

    expect(insight.blockers).toEqual([
      { code: "checks_failed", text: "1 check failed" },
      { code: "behind", text: "Branch out of date" },
      { code: "review_required", text: "Review required" },
    ]);
  });

  it("skips the detail query when nothing failed or was cancelled", async () => {
    let detailCalls = 0;

    const { insight } = await collectInsight(
      recordedGitHub({
        fetchOverviewPage: async () => onlyPassingChecksPage(),
        fetchCheckRunDetails: async () => {
          detailCalls += 1;
          return checkRunDetails;
        },
      }),
    );

    expect(insight.checks.length).toBeGreaterThan(0);
    expect(detailCalls).toBe(0);
  });
});

describe("collectInsight waiting checks", () => {
  const uiReview = {
    __typename: "StatusContext",
    context: "UI Review",
    state: "PENDING",
    description: "Go review the new and updated UI",
    targetUrl: "https://www.chromatic.com/review",
    createdAt: "2026-10-08T13:45:13Z",
    isRequired: false,
  };
  const github = recordedGitHub({
    fetchOverviewPage: async () => onlyPassingChecksPage([uiReview]),
  });
  const statusOf = (checks: readonly { name: string; status: string }[]) =>
    checks.find((check) => check.name === "UI Review")?.status;

  it("reports a quiet pending status as waiting after every check run is done", async () => {
    const { insight } = await collectInsight(github, Date.parse("2026-10-08T13:50:00Z"));

    expect(statusOf(insight.checks)).toBe("waiting");
  });

  it("keeps a pending status running while it is still being updated", async () => {
    const { insight } = await collectInsight(github, Date.parse("2026-10-08T13:46:00Z"));

    expect(statusOf(insight.checks)).toBe("running");
  });
});

describe("collectInsight merge queue", () => {
  it("gives no queue state for a PR without a queue entry", async () => {
    const { insight } = await collectInsight(recordedGitHub());

    expect(insight.mergeQueue).toBeNull();
  });

  it.each([
    ["QUEUED", "queued"],
    ["AWAITING_CHECKS", "awaiting_checks"],
    ["MERGEABLE", "merging"],
    ["LOCKED", "merging"],
    ["UNMERGEABLE", "failed"],
  ])("maps the GitHub entry state %s to %s", async (githubState, state) => {
    const { insight } = await collectInsight(queuedGitHub(githubState, 3));

    expect(insight.mergeQueue).toEqual({ position: 3, state });
  });

  it("gives no merge blockers for a queued PR", async () => {
    const { insight } = await collectInsight(queuedGitHub("QUEUED"));

    expect(insight.blockers).toEqual([]);
  });

  it("sends the same requests for a queued PR as for one without a queue entry", async () => {
    const requests = async (github: GitHubReader) => {
      const sent: string[] = [];
      await collectInsight({
        fetchOverviewPage: (after) => {
          sent.push(`overview:${after}`);
          return github.fetchOverviewPage(after);
        },
        fetchCheckRunDetails: (ids) => {
          sent.push(`details:${ids.join(",")}`);
          return github.fetchCheckRunDetails(ids);
        },
      });
      return sent;
    };

    expect(await requests(queuedGitHub("QUEUED"))).toEqual(await requests(recordedGitHub()));
  });
});

describe("collectInsight on a merge queue repo", () => {
  const recordedPage = (page: unknown) => recordedGitHub({ fetchOverviewPage: async () => page });

  it("offers enqueue with no merge blockers for a PR that is ready to enqueue", async () => {
    const { insight } = await collectInsight(recordedPage(readyToEnqueuePage));

    expect(insight.blockers).toEqual([]);
    expect(insight.mergeQueue).toBeNull();
    expect(insight.mergeAction).toEqual({ kind: "enqueue" });
  });

  it("gives the queue position and state of a queued PR", async () => {
    const { insight } = await collectInsight(recordedPage(inMergeQueuePage));

    expect(insight.mergeQueue).toEqual({ position: 1, state: "awaiting_checks" });
    expect(insight.blockers).toEqual([]);
    expect(insight.mergeAction).toEqual({ kind: "queued" });
  });
});

describe("collectInsight merge action", () => {
  function readyPage(overrides: { isMergeQueueEnabled?: boolean } = {}) {
    const { repository } = onlyPassingChecksPage().data;
    return {
      data: {
        repository: {
          ...repository,
          viewerDefaultMergeMethod: "SQUASH",
          squashMergeAllowed: true,
          pullRequest: {
            ...repository.pullRequest,
            mergeStateStatus: "CLEAN",
            isMergeQueueEnabled: false,
            ...overrides,
          },
        },
      },
    };
  }

  it("merges a clean PR with the user's default method", async () => {
    const { insight } = await collectInsight(
      recordedGitHub({ fetchOverviewPage: async () => readyPage() }),
    );

    expect(insight.mergeAction).toEqual({ kind: "merge", method: "SQUASH" });
  });

  it("offers enqueue instead of merge when the base branch has a merge queue", async () => {
    const { insight } = await collectInsight(
      recordedGitHub({ fetchOverviewPage: async () => readyPage({ isMergeQueueEnabled: true }) }),
    );

    expect(insight.mergeAction).toEqual({ kind: "enqueue" });
  });
});

describe("collectInsight paging", () => {
  it("follows the contexts cursor to the last page", async () => {
    const cursors: (string | null)[] = [];
    const github = recordedGitHub();

    await collectInsight({
      ...github,
      fetchOverviewPage: (after) => {
        cursors.push(after);
        return github.fetchOverviewPage(after);
      },
    });

    expect(cursors).toEqual([null, "MTAw"]);
  });

  it("stops after the page limit", async () => {
    let calls = 0;

    await collectInsight(
      recordedGitHub({
        fetchOverviewPage: async () => {
          calls += 1;
          return pageOne;
        },
      }),
    );

    expect(calls).toBe(MAX_CONTEXT_PAGES);
  });

  it("rejects a response without a pull request", async () => {
    await expect(
      collectInsight(
        recordedGitHub({
          fetchOverviewPage: async () => ({
            data: { repository: { pullRequest: null } },
          }),
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("collectInsight on cli/cli PR 14583", () => {
  function cliGitHub(page: unknown = requiredChecksPage): GitHubReader {
    return recordedGitHub({ fetchOverviewPage: async () => page });
  }

  function withPullRequest(overrides: Record<string, unknown>) {
    const { repository } = requiredChecksPage.data;
    return {
      data: {
        repository: { ...repository, pullRequest: { ...repository.pullRequest, ...overrides } },
      },
    };
  }

  it("gives the branches, author, and diff size", async () => {
    const { insight } = await collectInsight(cliGitHub());

    expect(insight.pr).toMatchObject({
      headRefName: "bagtoad/add-accessibility-md",
      headOwner: null,
      isCrossRepository: false,
      baseRefName: "trunk",
      author: "BagToad",
      additions: 122,
      deletions: 0,
      changedFiles: 1,
    });
  });

  it("names the fork owner of a fork PR", async () => {
    const { insight } = await collectInsight(
      cliGitHub(
        withPullRequest({ isCrossRepository: true, headRepositoryOwner: { login: "alice" } }),
      ),
    );

    expect(insight.pr.headOwner).toBe("alice");
  });

  it("gives no author for a deleted account", async () => {
    const { insight } = await collectInsight(cliGitHub(withPullRequest({ author: null })));

    expect(insight.pr.author).toBeNull();
  });

  it("marks the required checks", async () => {
    const { insight } = await collectInsight(cliGitHub());
    const required = Object.fromEntries(
      insight.checks.map((check) => [check.name, check.required]),
    );

    expect(required).toEqual({
      "build (ubuntu-latest)": true,
      "build (windows-latest)": true,
      "build (macos-latest)": true,
      "label-external / label_issues": false,
      "close-from-default-branch / close-from-default-branch": false,
    });
  });

  it("offers to disable auto-merge that is on", async () => {
    const { insight } = await collectInsight(
      cliGitHub(withPullRequest({ autoMergeRequest: { mergeMethod: "SQUASH" } })),
    );

    expect(insight.autoMergeAction).toEqual({ kind: "disable", method: "SQUASH" });
  });

  it("offers no branch update for a clean PR", async () => {
    const { insight } = await collectInsight(cliGitHub());

    expect(insight.canUpdateBranch).toBe(false);
  });

  it("offers a branch update for a branch that is behind", async () => {
    const { insight } = await collectInsight(
      cliGitHub(withPullRequest({ mergeStateStatus: "BEHIND" })),
    );

    expect(insight.canUpdateBranch).toBe(true);
  });
});
