import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewThreadRequest } from "@get-bb/plugin-sdk";
import type { LinkedQueuePr, LoadedReviewQueue, ReviewQueueView } from "../contract";
import type { PullRequestRef } from "../core/pr-ref";
import type { FetchedQueue, QueuePr } from "../core/review-queue";
import type { TeamScanRequest } from "../core/team-prs";
import type { PrResolution } from "../pr-lookup";
import {
  createReviewQueueService,
  REVIEW_QUEUE_STORAGE_KEY,
  SHARED_ENVIRONMENT_MESSAGE,
  type QueueProject,
  type QueueThread,
  type ReviewQueueServiceDeps,
} from "./review-queue-service";

function queuePr(repo: string, number: number, overrides: Partial<QueuePr> = {}): QueuePr {
  return {
    repo,
    number,
    title: `PR ${number}`,
    author: "octocat",
    createdAt: "2026-09-30T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    draft: false,
    ci: "passed",
    reviewDecision: "REVIEW_REQUIRED",
    headRefName: `feature-${number}`,
    headOid: `head-${number}`,
    url: `https://github.com/${repo}/pull/${number}`,
    state: "open",
    closedAt: null,
    activity: null,
    ...overrides,
  };
}

function queueOf(
  prs: QueuePr[],
  tracked: QueuePr[] = [],
  gone: PullRequestRef[] = [],
): FetchedQueue {
  return {
    requests: { groups: prs.map((pr) => ({ repo: pr.repo, prs: [pr] })), truncated: false },
    tracked,
    gone,
  };
}

function project(
  id: string,
  gitRemoteUrl: string | null,
  updatedAt: number,
  kind: QueueProject["kind"] = "standard",
): QueueProject {
  return { id, kind, gitRemoteUrl, updatedAt };
}

function thread(
  id: string,
  environmentId: string | null,
  updatedAt: number,
  archivedAt: number | null = null,
  overrides: Partial<QueueThread> = {},
): QueueThread {
  return {
    id,
    environmentId,
    updatedAt,
    archivedAt,
    createdAt: 1,
    status: "active",
    hasPendingInteraction: false,
    ...overrides,
  };
}

function reviewThread(id: string, overrides: Partial<QueueThread> = {}): QueueThread {
  return thread(id, null, 1, null, overrides);
}

function reviewPrEntry(repo: string, number: number) {
  return {
    "review-pr": {
      v: 1,
      repo,
      number,
      title: `PR ${number}`,
      url: `https://github.com/${repo}/pull/${number}`,
    },
  };
}

function metadataOf(byThread: Record<string, unknown>) {
  return async (threadId: string) => byThread[threadId] ?? {};
}

function linkedTo(owner: string, repo: string, number: number): PrResolution {
  return { kind: "pr", target: { ref: { owner, repo, number }, hostId: "host-1", openOnBb: true } };
}

function fakeKv(entries = new Map<string, unknown>()) {
  return {
    entries,
    get: async <T>(key: string) => entries.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
    delete: async (key: string) => {
      entries.delete(key);
    },
    list: async (prefix: string) => [...entries.keys()].filter((key) => key.startsWith(prefix)),
  };
}

function mark(repo: string, number: number, headOid: string, markedAt = 1) {
  const [owner, name] = repo.split("/");
  return [
    `reviewed:${repo}#${number}`,
    { v: 1, owner, repo: name, number, headOid, markedAt },
  ] as const;
}

function serviceWith(overrides: Partial<ReviewQueueServiceDeps> = {}) {
  const hostIds: string[] = [];
  const trackedCalls: PullRequestRef[][] = [];
  const archived: string[] = [];
  const published: LoadedReviewQueue[] = [];
  const kv = fakeKv();
  const service = createReviewQueueService({
    primaryHostId: async () => "host-1",
    fetchReviewQueue: async (hostId, tracked) => {
      hostIds.push(hostId);
      trackedCalls.push(tracked);
      return queueOf([queuePr("Acme/API", 15)]);
    },
    scanTeamPrs: async () => ({ refs: [], scannedThrough: {} }),
    listProjects: async () => [],
    listThreads: async () => [],
    listReviewThreads: async () => [],
    readPluginMetadata: async () => ({}),
    spawnReviewThread: async () => "thr_spawned",
    archiveThread: async (threadId) => {
      archived.push(threadId);
    },
    resolveEnvironmentPr: async () => ({ kind: "no_pr" }),
    kv,
    publish: (result) => published.push(result),
    warn: () => {},
    now: () => 1_000,
    ...overrides,
  });
  return { service, hostIds, trackedCalls, archived, published, kv };
}

function viewOf(result: LoadedReviewQueue): ReviewQueueView {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${result.message}`);
  return result;
}

function allPrs(result: LoadedReviewQueue): LinkedQueuePr[] {
  const view = viewOf(result);
  return [...view.needsReview, ...view.reviewed].flatMap((group) => group.prs);
}

function firstReviewRequest(result: LoadedReviewQueue): LinkedQueuePr {
  return allPrs(result)[0]!;
}

function sections(result: LoadedReviewQueue) {
  const view = viewOf(result);
  const numbers = (section: ReviewQueueView["needsReview"]) =>
    section.map((group) => [group.repo, group.prs.map((pr) => pr.number)]);
  return { needsReview: numbers(view.needsReview), reviewed: numbers(view.reviewed) };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe("review queue service", () => {
  it("fetches the queue on the primary host and stamps the load time", async () => {
    const { service, hostIds } = serviceWith();

    const result = await service.refreshReviewQueue();

    expect(hostIds).toEqual(["host-1"]);
    expect(result).toMatchObject({ kind: "ok", loadedAt: 1_000 });
  });

  it("stores and publishes each load and returns the stored view without a GitHub call", async () => {
    const { service, hostIds, published } = serviceWith();

    const result = await service.refreshReviewQueue();

    expect(published).toEqual([result]);
    expect(await service.getReviewQueue()).toEqual(result);
    expect(hostIds).toHaveLength(1);
  });

  it("lists matching projects most recently updated first", async () => {
    const { service } = serviceWith({
      listProjects: async () => [
        project("prj_old", "https://github.com/acme/api.git", 1),
        project("prj_new", "git@github.com:Acme/API.git", 3),
        project("prj_mid", "https://github.com/ACME/api", 2),
        project("prj_other", "https://github.com/acme/web", 4),
      ],
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.projectIds).toEqual(["prj_new", "prj_mid", "prj_old"]);
  });

  it("ignores a personal project with a matching remote", async () => {
    const { service } = serviceWith({
      listProjects: async () => [
        project("prj_personal", "https://github.com/acme/api", 1, "personal"),
      ],
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.projectIds).toEqual([]);
  });

  it("gives no projects and no thread when nothing matches", async () => {
    const { service } = serviceWith({
      listProjects: async () => [
        project("prj_web", "https://github.com/acme/web", 1),
        project("prj_none", null, 2),
      ],
      listThreads: async () => [thread("thr_1", "env_1", 1)],
      resolveEnvironmentPr: async () => linkedTo("acme", "api", 99),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr).toMatchObject({ projectIds: [], thread: null });
  });

  it("links the most recently updated thread whose PR matches", async () => {
    const { service } = serviceWith({
      listThreads: async () => [
        thread("thr_old", "env_old", 1),
        thread("thr_new", "env_new", 2),
        thread("thr_other", "env_other", 3),
      ],
      resolveEnvironmentPr: async (environmentId) =>
        environmentId === "env_other" ? linkedTo("acme", "api", 16) : linkedTo("acme", "api", 15),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread?.id).toBe("thr_new");
  });

  it("ignores an archived thread", async () => {
    const { service } = serviceWith({
      listThreads: async () => [thread("thr_archived", "env_1", 2, 5)],
      resolveEnvironmentPr: async () => linkedTo("acme", "api", 15),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread).toBeNull();
  });

  it("resolves the PR of a shared environment once per refresh", async () => {
    const resolved: string[] = [];
    const { service } = serviceWith({
      listThreads: async () => [
        thread("thr_1", "env_1", 1),
        thread("thr_2", "env_1", 2),
        thread("thr_3", null, 3),
      ],
      resolveEnvironmentPr: async (environmentId) => {
        resolved.push(environmentId);
        return { kind: "no_pr" };
      },
    });

    await service.refreshReviewQueue();

    expect(resolved).toEqual(["env_1"]);
  });

  it("links the other threads when the PR lookup of one environment fails", async () => {
    const { service } = serviceWith({
      listThreads: async () => [
        thread("thr_broken", "env_broken", 2),
        thread("thr_ok", "env_ok", 1),
      ],
      resolveEnvironmentPr: async (environmentId) => {
        if (environmentId === "env_broken") throw new Error("environment not found");
        return linkedTo("acme", "api", 15);
      },
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread?.id).toBe("thr_ok");
  });

  it("returns the gh failure together with the last good result", async () => {
    let fail = false;
    const { service } = serviceWith({
      fetchReviewQueue: async () => {
        if (fail) throw new Error("gh not logged in");
        return queueOf([queuePr("acme/api", 15)]);
      },
    });
    const good = await service.refreshReviewQueue();
    fail = true;

    const result = await service.refreshReviewQueue();

    if (good.kind !== "ok") throw new Error("expected ok");
    const { kind: _kind, ...lastGood } = good;
    expect(result).toEqual({ kind: "error", message: "gh not logged in", lastGood });
    expect(await service.getReviewQueue()).toEqual(result);
  });

  it("returns the gh failure without a last good result before any good load", async () => {
    const { service } = serviceWith({
      fetchReviewQueue: async () => {
        throw new Error("gh not installed");
      },
    });

    expect(await service.refreshReviewQueue()).toEqual({
      kind: "error",
      message: "gh not installed",
      lastGood: null,
    });
  });

  it("reports no host available and calls no host without a primary host", async () => {
    const { service, hostIds } = serviceWith({ primaryHostId: async () => null });

    const result = await service.refreshReviewQueue();

    expect(result).toEqual({ kind: "error", message: "No host available", lastGood: null });
    expect(hostIds).toEqual([]);
  });

  it("links a review thread by its metadata before its agent checks out the PR", async () => {
    const { service } = serviceWith({
      listThreads: async () => [thread("thr_review", "env_review", 1)],
      listReviewThreads: async () => [reviewThread("thr_review")],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread?.id).toBe("thr_review");
  });

  it("links the most recently updated thread across PR and metadata links", async () => {
    const { service } = serviceWith({
      listThreads: async () => [thread("thr_branch", "env_branch", 5)],
      listReviewThreads: async () => [reviewThread("thr_review", { updatedAt: 3 })],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      resolveEnvironmentPr: async () => linkedTo("acme", "api", 15),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread?.id).toBe("thr_branch");
  });

  it.each([
    ["active", false, "running"],
    ["starting", false, "running"],
    ["pending", false, "running"],
    ["stopping", false, "running"],
    ["idle", false, "idle"],
    ["error", false, "error"],
    ["idle", true, "needs_you"],
  ] as const)(
    "shows a %s thread (pending interaction %s) as %s on the PR row",
    async (status, hasPendingInteraction, shown) => {
      const { service } = serviceWith({
        listReviewThreads: async () => [
          reviewThread("thr_review", { status, hasPendingInteraction }),
        ],
        readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      });

      const pr = firstReviewRequest(await service.refreshReviewQueue());

      expect(pr.thread).toEqual({
        id: "thr_review",
        status: shown,
        isReviewThread: true,
        returned: shown === "needs_you" ? "needs_you" : null,
      });
    },
  );

  it("marks a thread linked only by its branch as not a review thread", async () => {
    const { service } = serviceWith({
      listThreads: async () => [thread("thr_branch", "env_1", 1, null, { status: "idle" })],
      resolveEnvironmentPr: async () => linkedTo("acme", "api", 15),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread).toEqual({
      id: "thr_branch",
      status: "idle",
      isReviewThread: false,
      returned: null,
    });
  });

  it("links no thread from archived threads and threads without valid metadata", async () => {
    const { service } = serviceWith({
      listThreads: async () => [thread("thr_archived", "env_1", 1, 5)],
      listReviewThreads: async () => [
        reviewThread("thr_archived", { archivedAt: 5 }),
        reviewThread("thr_plain"),
        reviewThread("thr_v2"),
        reviewThread("thr_broken"),
      ],
      readPluginMetadata: async (threadId) => {
        if (threadId === "thr_broken") throw new Error("thread not found");
        if (threadId === "thr_v2")
          return { "review-pr": { ...reviewPrEntry("acme/api", 15)["review-pr"], v: 2 } };
        if (threadId === "thr_archived") return reviewPrEntry("acme/api", 15);
        return {};
      },
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr.thread).toBeNull();
  });
});

describe("PR list content", () => {
  it("fetches the PRs of marks and of unarchived review threads once each", async () => {
    const { service, kv, trackedCalls } = serviceWith({
      listReviewThreads: async () => [
        reviewThread("thr_a"),
        reviewThread("thr_b"),
        reviewThread("thr_old", { archivedAt: 3 }),
      ],
      readPluginMetadata: metadataOf({
        thr_a: reviewPrEntry("Acme/API", 15),
        thr_b: reviewPrEntry("acme/web", 3),
        thr_old: reviewPrEntry("acme/web", 9),
      }),
    });
    kv.entries.set(...mark("acme/api", 15, "head-15"));

    await service.refreshReviewQueue();

    expect(trackedCalls).toEqual([
      [
        { owner: "acme", repo: "api", number: 15 },
        { owner: "acme", repo: "web", number: 3 },
      ],
    ]);
  });

  it("shows a requested PR once when it is also tracked", async () => {
    const { service } = serviceWith({
      fetchReviewQueue: async () => queueOf([queuePr("acme/api", 15)], [queuePr("acme/api", 15)]),
    });

    expect(
      allPrs(await service.refreshReviewQueue()).map((pr) => [pr.number, pr.requested]),
    ).toEqual([[15, true]]);
  });

  it("keeps a marked PR that is no longer requested", async () => {
    const { service, kv } = serviceWith({
      fetchReviewQueue: async () => queueOf([], [queuePr("acme/api", 15)]),
    });
    kv.entries.set(...mark("acme/api", 15, "head-15"));

    expect(sections(await service.refreshReviewQueue())).toEqual({
      needsReview: [],
      reviewed: [["acme/api", [15]]],
    });
  });

  it("keeps a PR with a review thread that is no longer requested", async () => {
    const { service } = serviceWith({
      fetchReviewQueue: async () => queueOf([], [queuePr("acme/api", 15)]),
      listReviewThreads: async () => [reviewThread("thr_review")],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
    });

    const pr = firstReviewRequest(await service.refreshReviewQueue());

    expect(pr).toMatchObject({ number: 15, requested: false, thread: { id: "thr_review" } });
  });

  it("leaves out a tracked PR without a mark or a review thread", async () => {
    const { service } = serviceWith({
      fetchReviewQueue: async () => queueOf([], [queuePr("acme/api", 15)]),
    });

    expect(allPrs(await service.refreshReviewQueue())).toEqual([]);
  });

  it("deletes the marks of gone PRs and leaves them out", async () => {
    const { service, kv } = serviceWith({
      fetchReviewQueue: async () =>
        queueOf(
          [],
          [],
          [
            { owner: "acme", repo: "api", number: 15 },
            { owner: "acme", repo: "web", number: 3 },
          ],
        ),
      listReviewThreads: async () => [reviewThread("thr_review")],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/web", 3) }),
    });
    kv.entries.set(...mark("acme/api", 15, "head-15"));

    const result = await service.refreshReviewQueue();

    expect(allPrs(result)).toEqual([]);
    expect([...kv.entries.keys()].filter((key) => key.startsWith("reviewed:"))).toEqual([]);
  });
});

describe("team PRs", () => {
  const NOW = Date.parse("2026-10-21T09:00:00Z");
  const WEEK = 7 * 24 * 3_600_000;
  const pr41 = { owner: "acme", repo: "api", number: 41 };

  function teamStore(refs: PullRequestRef[], scannedThrough: Record<string, string> = {}) {
    return ["team-prs", { v: 1, refs, scannedThrough }] as const;
  }

  function scanning(found: PullRequestRef[] | Error) {
    const requests: TeamScanRequest[] = [];
    return {
      requests,
      scanTeamPrs: async (_hostId: string, request: TeamScanRequest) => {
        requests.push(request);
        if (found instanceof Error) throw found;
        return {
          refs: found,
          scannedThrough: Object.fromEntries(
            request.repos.map(({ repo }) => [repo, request.startedAt]),
          ),
        };
      },
    };
  }

  it("lists a team PR after its review request is gone", async () => {
    const { service, kv } = serviceWith({
      now: () => NOW,
      fetchReviewQueue: async () => queueOf([], [queuePr("acme/api", 41)]),
    });
    kv.entries.set(...teamStore([pr41]));

    expect(sections(await service.refreshReviewQueue())).toEqual({
      needsReview: [["acme/api", [41]]],
      reviewed: [],
    });
  });

  it("lists a merged team PR with its merged state", async () => {
    const mergedAt = new Date(NOW - 3_600_000).toISOString();
    const { service, kv } = serviceWith({
      now: () => NOW,
      fetchReviewQueue: async () =>
        queueOf([], [queuePr("acme/api", 41, { state: "merged", closedAt: mergedAt })]),
    });
    kv.entries.set(...teamStore([pr41]));

    expect(firstReviewRequest(await service.refreshReviewQueue())).toMatchObject({
      number: 41,
      state: "merged",
      closedAt: mergedAt,
    });
  });

  it("drops a gone team PR and forgets it", async () => {
    const { service, kv } = serviceWith({
      now: () => NOW,
      fetchReviewQueue: async () => queueOf([], [], [pr41]),
    });
    kv.entries.set(...teamStore([pr41]));

    expect(allPrs(await service.refreshReviewQueue())).toEqual([]);
    expect(kv.entries.get("team-prs")).toMatchObject({ refs: [] });
  });

  it("fetches and lists the team PRs a scan finds, and remembers them", async () => {
    const trackedCalls: PullRequestRef[][] = [];
    const { service, kv } = serviceWith({
      now: () => NOW,
      scanTeamPrs: scanning([pr41]).scanTeamPrs,
      fetchReviewQueue: async (_hostId, tracked) => {
        trackedCalls.push(tracked);
        return tracked.length === 0
          ? queueOf([queuePr("acme/api", 15)])
          : queueOf([queuePr("acme/api", 15)], [queuePr("acme/api", 41)]);
      },
    });

    const result = await service.refreshReviewQueue();

    expect(trackedCalls).toEqual([[], [pr41]]);
    expect(sections(result).needsReview).toEqual([["acme/api", [15, 41]]]);
    expect(kv.entries.get("team-prs")).toEqual({
      v: 1,
      refs: [pr41],
      scannedThrough: { "acme/api": new Date(NOW).toISOString() },
    });
  });

  it("scans the repositories of review requests and team PRs, a week back the first time", async () => {
    const scan = scanning([]);
    const { service, kv } = serviceWith({
      now: () => NOW,
      scanTeamPrs: scan.scanTeamPrs,
      fetchReviewQueue: async () => queueOf([queuePr("Acme/API", 15)], [queuePr("acme/web", 3)]),
    });
    kv.entries.set(
      ...teamStore([{ owner: "acme", repo: "web", number: 3 }], {
        "acme/web": "2026-10-21T08:00:00.000Z",
      }),
    );

    await service.refreshReviewQueue();

    expect(scan.requests).toEqual([
      {
        repos: [
          { repo: "acme/api", since: new Date(NOW - WEEK).toISOString() },
          { repo: "acme/web", since: "2026-10-21T07:50:00.000Z" },
        ],
        startedAt: new Date(NOW).toISOString(),
      },
    ]);
  });

  it("finds a stored team PR again without adding or fetching it twice", async () => {
    const trackedCalls: PullRequestRef[][] = [];
    const { service, kv } = serviceWith({
      now: () => NOW,
      scanTeamPrs: scanning([pr41]).scanTeamPrs,
      fetchReviewQueue: async (_hostId, tracked) => {
        trackedCalls.push(tracked);
        return queueOf([], [queuePr("acme/api", 41)]);
      },
    });
    kv.entries.set(...teamStore([pr41]));

    await service.refreshReviewQueue();

    expect(trackedCalls).toEqual([[pr41]]);
    expect(kv.entries.get("team-prs")).toMatchObject({ refs: [pr41] });
  });

  it("keeps the scanned time and still loads the queue when the scan fails", async () => {
    const warnings: string[] = [];
    const { service, kv } = serviceWith({
      now: () => NOW,
      scanTeamPrs: scanning(new Error("gh: HTTP 502")).scanTeamPrs,
      fetchReviewQueue: async () => queueOf([], [queuePr("acme/api", 41)]),
      warn: (message) => warnings.push(message),
    });
    const stored = teamStore([pr41], { "acme/api": "2026-10-21T08:00:00.000Z" });
    kv.entries.set(...stored);

    const result = await service.refreshReviewQueue();

    expect(sections(result).needsReview).toEqual([["acme/api", [41]]]);
    expect(kv.entries.get("team-prs")).toEqual(stored[1]);
    expect(warnings).toEqual(["Team pull request scan failed: gh: HTTP 502"]);
  });

  it("scans nothing without review requests or team PRs", async () => {
    const scan = scanning([]);
    const { service } = serviceWith({
      scanTeamPrs: scan.scanTeamPrs,
      fetchReviewQueue: async () => queueOf([]),
    });

    await service.refreshReviewQueue();

    expect(scan.requests).toEqual([]);
  });
});

describe("reviewed state", () => {
  it("puts a PR without a mark in Needs review", async () => {
    const { service } = serviceWith();

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result).review).toBe("needs_review");
    expect(sections(result)).toEqual({ needsReview: [["Acme/API", [15]]], reviewed: [] });
  });

  it("puts a PR marked at its head in Reviewed", async () => {
    const { service, kv } = serviceWith();
    kv.entries.set(...mark("acme/api", 15, "head-15"));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result).review).toBe("reviewed");
    expect(sections(result)).toEqual({ needsReview: [], reviewed: [["Acme/API", [15]]] });
  });

  it("puts a PR back in Needs review as updated since review after a push", async () => {
    const { service, kv } = serviceWith({
      fetchReviewQueue: async () => queueOf([queuePr("acme/api", 15, { headOid: "def456" })]),
    });
    kv.entries.set(...mark("acme/api", 15, "abc123"));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result).review).toBe("updated_since_review");
    expect(sections(result).needsReview).toEqual([["acme/api", [15]]]);
  });
});

describe("new activity after the mark", () => {
  const MARKED_AT = Date.parse("2026-10-07T08:30:00Z");
  const BEFORE = "2026-10-07T08:00:00Z";
  const AFTER = "2026-10-07T08:38:57Z";

  function tracked15(activity: QueuePr["activity"], overrides: Partial<QueuePr> = {}) {
    return queuePr("acme/api", 15, { activity, ...overrides });
  }

  function activityOf(
    conversationAt: string | null,
    lastRequestedAt: string | null = null,
    inlineComments: { id: string; postedAt: string }[] = [],
  ) {
    const conversationComments =
      conversationAt === null ? [] : [conversation("IC_1", conversationAt)];
    return { conversationComments, inlineComments, lastRequestedAt };
  }

  function conversation(id: string, postedAt = AFTER) {
    return { id, postedAt };
  }

  function replies(...ids: string[]) {
    return activityOf(
      null,
      null,
      ids.map((id) => ({ id, postedAt: AFTER })),
    );
  }

  function seenComments(...ids: string[]) {
    return ["comment-seen:v1:acme/api#15", { v: 1, ids }] as const;
  }

  function serviceWithTracked(requested: QueuePr[], tracked: QueuePr[]) {
    return serviceWith({ fetchReviewQueue: async () => queueOf(requested, tracked) });
  }

  it("puts a marked PR back in Needs review with new comments after a reply", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(activityOf(AFTER))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result)).toMatchObject({
      review: "reviewed",
      newActivity: ["new_comments"],
    });
    expect(sections(result)).toEqual({ needsReview: [["acme/api", [15]]], reviewed: [] });
  });

  it("keeps a marked PR in Reviewed when the comment came before the mark", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(activityOf(BEFORE, BEFORE))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result).newActivity).toEqual([]);
    expect(sections(result)).toEqual({ needsReview: [], reviewed: [["acme/api", [15]]] });
  });

  it("puts a requested and marked PR back in Needs review after a new review request", async () => {
    const { service, kv } = serviceWithTracked(
      [queuePr("acme/api", 15)],
      [tracked15(activityOf(null, AFTER))],
    );
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result)).toMatchObject({
      requested: true,
      newActivity: ["requested_again"],
    });
    expect(sections(result).reviewed).toEqual([]);
  });

  it("shows a push and a reply together", async () => {
    const { service, kv } = serviceWithTracked(
      [],
      [tracked15(activityOf(AFTER, AFTER), { headOid: "def456" })],
    );
    kv.entries.set(...mark("acme/api", 15, "abc123", MARKED_AT));

    expect(firstReviewRequest(await service.refreshReviewQueue())).toMatchObject({
      review: "updated_since_review",
      newActivity: ["new_comments", "requested_again"],
    });
  });

  it("shows no new activity on a PR with a review thread and no mark", async () => {
    const { service } = serviceWith({
      fetchReviewQueue: async () => queueOf([], [tracked15(activityOf(AFTER))]),
      listReviewThreads: async () => [reviewThread("thr_review")],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
    });

    expect(firstReviewRequest(await service.refreshReviewQueue()).newActivity).toEqual([]);
  });

  it("shows the accent when a marked PR comes back with new activity", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(activityOf(AFTER))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));

    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(true);
  });

  it("moves the PR to Reviewed when the user marks it reviewed again", async () => {
    const { service, kv, published } = serviceWith({
      fetchReviewQueue: async () => queueOf([], [tracked15(activityOf(AFTER, AFTER))]),
      now: () => Date.parse("2026-10-07T09:00:00Z"),
    });
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    await service.refreshReviewQueue();

    await service.markReviewed({ repo: "acme/api", number: 15, headOid: "head-15" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(firstReviewRequest(published[1]!).newActivity).toEqual([]);
    expect(sections(published[1]!)).toEqual({ needsReview: [], reviewed: [["acme/api", [15]]] });
  });

  it("puts a marked PR back in Needs review after an unseen inline reply", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(replies("PRRC_1"))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));

    expect(firstReviewRequest(await service.refreshReviewQueue()).newActivity).toEqual([
      "new_comments",
    ]);
  });

  it("keeps a marked PR in Reviewed when the user saw all new replies", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(replies("PRRC_1", "PRRC_2"))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRRC_1", "PRRC_2"));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result).newActivity).toEqual([]);
    expect(sections(result)).toEqual({ needsReview: [], reviewed: [["acme/api", [15]]] });
  });

  it("keeps new comments when the user saw one of two replies", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(replies("PRRC_1", "PRRC_2"))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRRC_1"));

    expect(firstReviewRequest(await service.refreshReviewQueue()).newActivity).toEqual([
      "new_comments",
    ]);
  });

  it("keeps new comments for a conversation comment after a seen reply", async () => {
    const activity = activityOf(AFTER, null, [{ id: "PRRC_1", postedAt: AFTER }]);
    const { service, kv } = serviceWithTracked([], [tracked15(activity)]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRRC_1"));

    expect(firstReviewRequest(await service.refreshReviewQueue()).newActivity).toEqual([
      "new_comments",
    ]);
  });

  it("drops new comments when the user saw the conversation comment", async () => {
    const { service, kv } = serviceWithTracked([], [tracked15(activityOf(AFTER))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("IC_1"));

    const result = await service.refreshReviewQueue();

    expect(firstReviewRequest(result).newActivity).toEqual([]);
    expect(sections(result)).toEqual({ needsReview: [], reviewed: [["acme/api", [15]]] });
  });

  it("drops new comments when the user saw a review text", async () => {
    const activity = { ...activityOf(null), conversationComments: [conversation("PRR_1")] };
    const { service, kv } = serviceWithTracked([], [tracked15(activity)]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRR_1"));

    expect(firstReviewRequest(await service.refreshReviewQueue()).newActivity).toEqual([]);
  });

  it("keeps new comments when the user saw a review text but not its inline comment", async () => {
    const activity = {
      ...activityOf(null, null, [{ id: "PRRC_1", postedAt: AFTER }]),
      conversationComments: [conversation("PRR_1")],
    };
    const { service, kv } = serviceWithTracked([], [tracked15(activity)]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRR_1"));

    expect(firstReviewRequest(await service.refreshReviewQueue()).newActivity).toEqual([
      "new_comments",
    ]);
  });

  it("keeps the push but drops new comments after a seen reply", async () => {
    const { service, kv } = serviceWithTracked(
      [],
      [tracked15(replies("PRRC_1"), { headOid: "def456" })],
    );
    kv.entries.set(...mark("acme/api", 15, "abc123", MARKED_AT));
    kv.entries.set(...seenComments("PRRC_1"));

    expect(firstReviewRequest(await service.refreshReviewQueue())).toMatchObject({
      review: "updated_since_review",
      newActivity: [],
    });
  });

  it("drops new comments when the user sees the last reply", async () => {
    const { service, kv, published } = serviceWithTracked([], [tracked15(replies("PRRC_1"))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    await service.refreshReviewQueue();

    expect(
      await service.markCommentsSeen({ owner: "acme", repo: "api", number: 15 }, ["PRRC_1"]),
    ).toEqual({ kind: "ok" });

    expect(kv.entries.get("comment-seen:v1:acme/api#15")).toEqual({ v: 1, ids: ["PRRC_1"] });
    expect(firstReviewRequest(published.at(-1)!).newActivity).toEqual([]);
  });

  it("returns an error when the seen comments cannot be saved", async () => {
    const { service, kv } = serviceWith();
    kv.set = async () => {
      throw new Error("disk full");
    };

    expect(
      await service.markCommentsSeen({ owner: "acme", repo: "api", number: 15 }, ["PRRC_1"]),
    ).toEqual({ kind: "error", message: "disk full" });
  });

  it.each([
    ["marks it reviewed", "markReviewed"],
    ["marks it as needs review", "markNeedsReview"],
  ] as const)("deletes the seen comments when the user %s", async (_, action) => {
    const { service, kv } = serviceWithTracked([], [tracked15(replies("PRRC_1"))]);
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRRC_1"));
    await service.refreshReviewQueue();

    await service[action]({ repo: "acme/api", number: 15, headOid: "head-15" });

    expect(kv.entries.has("comment-seen:v1:acme/api#15")).toBe(false);
  });

  it("marks the PR reviewed and warns when the seen comments cannot be deleted", async () => {
    const warnings: string[] = [];
    const { service, kv } = serviceWith({ warn: (message) => warnings.push(message) });
    kv.delete = async () => {
      throw new Error("disk full");
    };

    expect(
      await service.markReviewed({ repo: "acme/api", number: 15, headOid: "head-15" }),
    ).toEqual({ kind: "ok" });
    expect(warnings).toEqual(["Could not delete seen comments of acme/api#15: disk full"]);
  });

  it("reads the mark time and seen comments of a PR", async () => {
    const { service, kv } = serviceWith();
    kv.entries.set(...mark("acme/api", 15, "head-15", MARKED_AT));
    kv.entries.set(...seenComments("PRRC_1"));

    expect(await service.newCommentBasis({ owner: "acme", repo: "api", number: 15 })).toEqual({
      markedAt: MARKED_AT,
      seen: new Set(["PRRC_1"]),
    });
    expect(await service.newCommentBasis({ owner: "acme", repo: "api", number: 16 })).toEqual({
      markedAt: null,
      seen: new Set(),
    });
  });

  it.each([
    ["inline comment tracking", 2],
    ["conversation comment ids", 3],
    ["PR states", 4],
  ])("drops a stored queue from before %s", async (_, v) => {
    const { service, kv } = serviceWith();
    const loaded = await service.refreshReviewQueue();
    kv.entries.set(REVIEW_QUEUE_STORAGE_KEY, { v, result: loaded });

    expect(await service.getReviewQueue()).toEqual({ kind: "loading" });
  });

  it("reads a stored PR from before activity tracking as without activity", async () => {
    const { service, kv } = serviceWith();
    const loaded = await service.refreshReviewQueue();
    const stored = structuredClone(loaded) as { kind: "ok" } & Record<string, unknown>;
    const prs = (stored.needsReview as { prs: Record<string, unknown>[] }[])[0]!.prs;
    delete prs[0]!.newActivity;
    delete prs[0]!.activity;
    kv.entries.set(REVIEW_QUEUE_STORAGE_KEY, { v: 5, result: stored });

    expect(firstReviewRequest((await service.getReviewQueue()) as LoadedReviewQueue)).toMatchObject(
      { activity: null, newActivity: [] },
    );
  });
});

describe("sort order", () => {
  it("puts groups and PRs whose thread needs the user first, then sorts by last update", async () => {
    const { service } = serviceWith({
      fetchReviewQueue: async () =>
        queueOf([
          queuePr("acme/api", 15, { updatedAt: "2026-10-02T09:55:00Z" }),
          queuePr("acme/api", 12, { updatedAt: "2026-10-02T09:00:00Z" }),
          queuePr("acme/web", 3, { updatedAt: "2026-09-30T09:00:00Z" }),
          queuePr("acme/web", 4, { updatedAt: "2026-10-01T09:00:00Z" }),
          queuePr("acme/docs", 1),
        ]),
      listReviewThreads: async () => [reviewThread("thr_review", { hasPendingInteraction: true })],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/web", 3) }),
    });

    expect(sections(await service.refreshReviewQueue()).needsReview).toEqual([
      ["acme/web", [3, 4]],
      ["acme/api", [15, 12]],
      ["acme/docs", [1]],
    ]);
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stored review queue", () => {
  it("reports loading before the first load", async () => {
    const { service, hostIds } = serviceWith();

    expect(await service.getReviewQueue()).toEqual({ kind: "loading" });
    expect(hostIds).toEqual([]);
  });

  it("reads an entry of another version as loading", async () => {
    const { service, kv } = serviceWith();
    kv.entries.set(REVIEW_QUEUE_STORAGE_KEY, {
      v: 1,
      result: { kind: "error", message: "x", lastGood: null },
    });

    expect(await service.getReviewQueue()).toEqual({ kind: "loading" });
  });

  it("returns the view stored before a restart without a GitHub call", async () => {
    const first = serviceWith();
    const loaded = await first.service.refreshReviewQueue();

    const restarted = serviceWith({ kv: first.kv });

    expect(await restarted.service.getReviewQueue()).toEqual(loaded);
    expect(restarted.hostIds).toEqual([]);
  });

  it("runs one load at a time and one more after a Refresh during a load", async () => {
    const fetches: ReturnType<typeof deferred<FetchedQueue>>[] = [];
    const { service } = serviceWith({
      fetchReviewQueue: () => {
        const fetch = deferred<FetchedQueue>();
        fetches.push(fetch);
        return fetch.promise;
      },
    });

    const first = service.refreshReviewQueue();
    await vi.waitFor(() => expect(fetches).toHaveLength(1));
    const second = service.refreshReviewQueue();
    const third = service.refreshReviewQueue();
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetches).toHaveLength(1);

    fetches[0]!.resolve(queueOf([queuePr("acme/api", 15)]));
    await first;
    await vi.waitFor(() => expect(fetches).toHaveLength(2));
    fetches[1]!.resolve(queueOf([queuePr("acme/api", 16)]));

    expect(firstReviewRequest(await second).number).toBe(16);
    expect(await third).toEqual(await second);
    expect(fetches).toHaveLength(2);
  });
});

describe("review-queue background service", () => {
  it("loads at start and every 5 minutes until aborted", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { service, hostIds, published } = serviceWith();
    const controller = new AbortController();

    const run = service.run(controller.signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(hostIds).toHaveLength(1);
    expect(published).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(hostIds).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(hostIds).toHaveLength(2);

    controller.abort();
    await expect(run).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(hostIds).toHaveLength(2);
  });

  it("stops when aborted while a GitHub call never answers", async () => {
    const { service } = serviceWith({ fetchReviewQueue: () => new Promise(() => {}) });
    const controller = new AbortController();

    const run = service.run(controller.signal);
    controller.abort();

    await expect(run).resolves.toBeUndefined();
  });
});

describe("startReview", () => {
  const pr = {
    repo: "acme/api",
    number: 15,
    title: "PR 15",
    url: "https://github.com/acme/api/pull/15",
  };
  const request = {
    projectId: "prj_api",
    environment: { type: "provider", environmentProviderId: "git-worktree", inputs: {} },
  } as NewThreadRequest;

  it("spawns the review thread and publishes it linked without a GitHub call", async () => {
    const reviewThreads: QueueThread[] = [];
    const spawned: unknown[] = [];
    const { service, hostIds, published } = serviceWith({
      listReviewThreads: async () => reviewThreads,
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      spawnReviewThread: async (...args) => {
        spawned.push(args);
        reviewThreads.push(reviewThread("thr_review"));
        return "thr_review";
      },
    });
    await service.refreshReviewQueue();

    expect(await service.startReview(pr, request)).toBe("thr_review");

    expect(spawned).toEqual([[pr, request]]);
    await vi.waitFor(() => expect(published).toHaveLength(2));
    const update = published[1]!;
    expect(firstReviewRequest(update).thread?.id).toBe("thr_review");
    expect(update).toMatchObject({ loadedAt: 1_000 });
    expect(hostIds).toHaveLength(1);
    expect(await service.getReviewQueue()).toEqual(update);
  });

  it("rejects a shared environment without spawning or publishing", async () => {
    const spawned: unknown[] = [];
    const { service, published } = serviceWith({
      spawnReviewThread: async (...args) => {
        spawned.push(args);
        return "thr_review";
      },
    });
    await service.refreshReviewQueue();
    const checkout = {
      ...request,
      environment: { type: "provider", environmentProviderId: "project-checkout", inputs: {} },
    } as NewThreadRequest;

    await expect(service.startReview(pr, checkout)).rejects.toThrow(SHARED_ENVIRONMENT_MESSAGE);

    expect(spawned).toEqual([]);
    expect(published).toHaveLength(1);
  });

  it("updates the last good view and keeps the error after a failed load", async () => {
    let fail = false;
    const reviewThreads: QueueThread[] = [];
    const { service, published } = serviceWith({
      fetchReviewQueue: async () => {
        if (fail) throw new Error("rate limited");
        return queueOf([queuePr("acme/api", 15)]);
      },
      listReviewThreads: async () => reviewThreads,
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      spawnReviewThread: async () => {
        reviewThreads.push(reviewThread("thr_review"));
        return "thr_review";
      },
    });
    await service.refreshReviewQueue();
    fail = true;
    await service.refreshReviewQueue();

    await service.startReview(pr, request);

    await vi.waitFor(() => expect(published).toHaveLength(3));
    const update = published[2]!;
    if (update.kind !== "error") throw new Error("expected error");
    expect(update.message).toBe("rate limited");
    expect(update.lastGood?.needsReview[0]!.prs[0]!.thread?.id).toBe("thr_review");
  });

  it("keeps a load that finished during the re-link", async () => {
    let number = 15;
    let clock = 1_000;
    let gate: ReturnType<typeof deferred<void>> | null = null;
    const { service, published } = serviceWith({
      fetchReviewQueue: async () => queueOf([queuePr("acme/api", number)]),
      listProjects: async () => {
        const open = gate;
        gate = null;
        await open?.promise;
        return [];
      },
      now: () => clock++,
    });
    await service.refreshReviewQueue();
    const relinkGate = deferred<void>();
    gate = relinkGate;

    await service.startReview(pr, request);
    number = 16;
    const newer = await service.refreshReviewQueue();
    relinkGate.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(await service.getReviewQueue()).toEqual(newer);
    expect(published).toHaveLength(2);
  });

  it("publishes nothing before the first load", async () => {
    const { service, published } = serviceWith();

    await service.startReview(pr, request);
    await new Promise((resolve) => setImmediate(resolve));

    expect(published).toEqual([]);
  });

  it("rejects when the spawn fails", async () => {
    const { service } = serviceWith({
      spawnReviewThread: async () => {
        throw new Error("project not found");
      },
    });

    await expect(service.startReview(pr, request)).rejects.toThrow("project not found");
  });
});

describe("archiveReview", () => {
  it("publishes the view without the archived thread and without a GitHub call", async () => {
    const reviewThreads = [reviewThread("thr_review")];
    const { service, hostIds, published } = serviceWith({
      listReviewThreads: async () => reviewThreads,
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      archiveThread: async (threadId) => {
        reviewThreads.splice(0, reviewThreads.length, reviewThread(threadId, { archivedAt: 5 }));
      },
    });
    const loaded = await service.refreshReviewQueue();
    expect(firstReviewRequest(loaded).thread?.id).toBe("thr_review");

    expect(await service.archiveReview("thr_review")).toEqual({ kind: "ok" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    const update = published[1]!;
    expect(firstReviewRequest(update).thread).toBeNull();
    expect(hostIds).toHaveLength(1);
  });

  it("archives a thread with review-pr metadata", async () => {
    const { service, archived } = serviceWith({
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
    });

    expect(await service.archiveReview("thr_review")).toEqual({ kind: "ok" });
    expect(archived).toEqual(["thr_review"]);
  });

  it("refuses a thread without review-pr metadata", async () => {
    const { service, archived } = serviceWith({
      readPluginMetadata: metadataOf({ thr_other: { prSummary: {} } }),
    });

    expect(await service.archiveReview("thr_other")).toEqual({
      kind: "error",
      message: "This thread is not a review thread",
    });
    expect(archived).toEqual([]);
  });

  it("reports a failed archive", async () => {
    const { service } = serviceWith({
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      archiveThread: async () => {
        throw new Error("thread not found");
      },
    });

    expect(await service.archiveReview("thr_review")).toEqual({
      kind: "error",
      message: "thread not found",
    });
  });
});

describe("archiveReview on a PR kept only by its thread", () => {
  it("drops the PR from the list without a GitHub call", async () => {
    const reviewThreads = [reviewThread("thr_review")];
    let fetches = 0;
    const { service, published } = serviceWith({
      fetchReviewQueue: async () => {
        fetches++;
        return queueOf([], [queuePr("acme/api", 15)]);
      },
      listReviewThreads: async () => reviewThreads,
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
      archiveThread: async (threadId) => {
        reviewThreads.splice(0, reviewThreads.length, reviewThread(threadId, { archivedAt: 5 }));
      },
    });
    await service.refreshReviewQueue();

    await service.archiveReview("thr_review");

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(allPrs(published[1]!)).toEqual([]);
    expect(fetches).toBe(1);
  });
});

describe("markReviewed", () => {
  it("moves a listed PR to Reviewed without a GitHub call", async () => {
    const { service, hostIds, published } = serviceWith();
    await service.refreshReviewQueue();

    expect(
      await service.markReviewed({ repo: "Acme/API", number: 15, headOid: "head-15" }),
    ).toEqual({ kind: "ok" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(sections(published[1]!)).toEqual({ needsReview: [], reviewed: [["Acme/API", [15]]] });
    expect(hostIds).toHaveLength(1);
  });

  it("keeps both marks when a second mark lands during the re-link of the first", async () => {
    let gate: ReturnType<typeof deferred<void>> | null = null;
    const { service } = serviceWith({
      fetchReviewQueue: async () => queueOf([queuePr("acme/api", 15), queuePr("acme/api", 16)]),
      listProjects: async () => {
        const open = gate;
        gate = null;
        await open?.promise;
        return [];
      },
    });
    await service.refreshReviewQueue();
    const firstRelink = deferred<void>();
    gate = firstRelink;

    const first = service.markReviewed({ repo: "acme/api", number: 15, headOid: "head-15" });
    await vi.waitFor(() => expect(gate).toBeNull());
    const second = service.markReviewed({ repo: "acme/api", number: 16, headOid: "head-16" });
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
    firstRelink.resolve();
    await Promise.all([first, second]);

    const stored = await service.getReviewQueue();
    if (stored.kind === "loading") throw new Error("expected a stored view");
    expect(
      allPrs(stored)
        .filter((pr) => pr.review === "reviewed")
        .map((pr) => pr.number)
        .sort(),
    ).toEqual([15, 16]);
  });

  it("rejects a repository that is not owner/name", async () => {
    const { service } = serviceWith();

    expect(await service.markReviewed({ repo: "acme", number: 15, headOid: "head-15" })).toEqual({
      kind: "error",
      message: "Repository must be owner/name",
    });
  });

  it("keeps the commit shown on the card, so a newer head shows as updated since review", async () => {
    const { service, published } = serviceWith({
      fetchReviewQueue: async () => queueOf([queuePr("acme/api", 15, { headOid: "def456" })]),
    });
    await service.refreshReviewQueue();

    await service.markReviewed({ repo: "acme/api", number: 15, headOid: "abc123" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(firstReviewRequest(published[1]!).review).toBe("updated_since_review");
  });

  it("loads from GitHub to show a marked PR that is not in the list yet", async () => {
    let marked = false;
    const { service, hostIds, published } = serviceWith({
      fetchReviewQueue: async (hostId) => {
        hostIds.push(hostId);
        return queueOf([], marked ? [queuePr("acme/web", 3)] : []);
      },
    });
    await service.refreshReviewQueue();
    marked = true;

    await service.markReviewed({ repo: "acme/web", number: 3, headOid: "head-3" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(sections(published[1]!).reviewed).toEqual([["acme/web", [3]]]);
    expect(hostIds).toHaveLength(2);
  });

  it("reports a failed save", async () => {
    const kv = fakeKv();
    const { service } = serviceWith({
      kv: {
        ...kv,
        set: async (key: string, value: unknown) => {
          if (key.startsWith("reviewed:")) throw new Error("disk full");
          await kv.set(key, value);
        },
      },
    });

    expect(
      await service.markReviewed({ repo: "acme/api", number: 15, headOid: "head-15" }),
    ).toEqual({
      kind: "error",
      message: "disk full",
    });
  });
});

describe("markNeedsReview", () => {
  it("moves a requested PR back to Needs review without an updated label", async () => {
    const { service, kv, published } = serviceWith();
    kv.entries.set(...mark("acme/api", 15, "head-15"));
    await service.refreshReviewQueue();

    expect(await service.markNeedsReview({ repo: "Acme/API", number: 15 })).toEqual({ kind: "ok" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(firstReviewRequest(published[1]!).review).toBe("needs_review");
    expect(sections(published[1]!).reviewed).toEqual([]);
  });

  it("drops a PR that is listed only because of its mark", async () => {
    const { service, kv, published } = serviceWith({
      fetchReviewQueue: async () => queueOf([], [queuePr("acme/api", 15)]),
    });
    kv.entries.set(...mark("acme/api", 15, "head-15"));
    await service.refreshReviewQueue();

    await service.markNeedsReview({ repo: "acme/api", number: 15 });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(allPrs(published[1]!)).toEqual([]);
  });

  it("reports a failed delete", async () => {
    const kv = fakeKv();
    const { service } = serviceWith({
      kv: {
        ...kv,
        delete: async () => {
          throw new Error("disk full");
        },
      },
    });

    expect(await service.markNeedsReview({ repo: "acme/api", number: 15 })).toEqual({
      kind: "error",
      message: "disk full",
    });
  });
});

describe("unseen PRs", () => {
  function seen(...keys: string[]) {
    return ["review-seen", { v: 1, keys }] as const;
  }

  it("reads a stored view from before unseen tracking as all seen", async () => {
    const { service, kv } = serviceWith();
    kv.entries.set(REVIEW_QUEUE_STORAGE_KEY, {
      v: 5,
      result: { kind: "ok", needsReview: [], reviewed: [], truncated: false, loadedAt: 1 },
    });

    expect(await service.getReviewQueue()).toMatchObject({ hasUnseen: false });
  });

  it("is unseen when a needs-review PR was never seen", async () => {
    const { service } = serviceWith();

    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(true);
  });

  it("is seen when the seen set holds every needs-review PR, whatever their head", async () => {
    const { service, kv } = serviceWith({
      fetchReviewQueue: async () => queueOf([queuePr("Acme/API", 15, { headOid: "new-head" })]),
    });
    kv.entries.set(...seen("acme/api#15"));

    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(false);
  });

  it("ignores reviewed PRs", async () => {
    const { service, kv } = serviceWith();
    kv.entries.set(...mark("acme/api", 15, "head-15"));

    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(false);
  });

  it("publishes a seen view after the panel marks what it shows", async () => {
    const { service, published } = serviceWith();
    await service.refreshReviewQueue();

    expect(await service.markQueueSeen({ prs: [{ repo: "Acme/API", number: 15 }] })).toEqual({
      kind: "ok",
    });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(viewOf(published[1]!).hasUnseen).toBe(false);
  });

  it("forgets a seen PR that leaves Needs review, so a new request for it is unseen", async () => {
    let prs = [queuePr("acme/api", 16)];
    const { service, kv } = serviceWith({ fetchReviewQueue: async () => queueOf(prs) });
    kv.entries.set(...seen("acme/api#15", "acme/api#16"));

    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(false);
    expect(kv.entries.get("review-seen")).toEqual({ v: 1, keys: ["acme/api#16"] });

    prs = [queuePr("acme/api", 15), queuePr("acme/api", 16)];
    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(true);
  });

  it("replaces the seen set, so a PR that left and returns is unseen again", async () => {
    let prs = [queuePr("acme/api", 15)];
    const { service, kv } = serviceWith({ fetchReviewQueue: async () => queueOf(prs) });
    kv.entries.set(...seen("acme/api#15", "acme/api#16"));
    await service.refreshReviewQueue();

    await service.markQueueSeen({ prs: [{ repo: "acme/api", number: 15 }] });
    prs = [queuePr("acme/api", 15), queuePr("acme/api", 16)];

    expect(viewOf(await service.refreshReviewQueue()).hasUnseen).toBe(true);
  });
});

describe("returned review threads", () => {
  function reviewOn15(overrides: Partial<QueueThread> = {}) {
    return {
      listReviewThreads: async () => [reviewThread("thr_review", { status: "idle", ...overrides })],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
    };
  }

  function returnedOf(result: LoadedReviewQueue) {
    return { row: firstReviewRequest(result).thread?.returned, view: viewOf(result).hasReturned };
  }

  it("reads a stored thread from before returned tracking as not returned", async () => {
    const { service, kv } = serviceWith(reviewOn15());
    const loaded = await service.refreshReviewQueue();
    const stored = structuredClone(loaded) as { kind: "ok" } & Record<string, unknown>;
    delete stored.hasReturned;
    const prs = (stored.needsReview as { prs: { thread: Record<string, unknown> }[] }[])[0]!.prs;
    delete prs[0]!.thread.returned;
    kv.entries.set(REVIEW_QUEUE_STORAGE_KEY, { v: 5, result: stored });

    expect(returnedOf((await service.getReviewQueue()) as LoadedReviewQueue)).toEqual({
      row: null,
      view: false,
    });
  });

  it.each([
    ["idle", "finished"],
    ["error", "failed"],
  ] as const)(
    "returns a review thread whose agent stopped as %s, as %s",
    async (status, reason) => {
      const { service, published } = serviceWith(reviewOn15({ status }));
      await service.refreshReviewQueue();

      await service.threadStopped("thr_review");

      await vi.waitFor(() => expect(published).toHaveLength(2));
      expect(returnedOf(published[1]!)).toEqual({ row: reason, view: true });
    },
  );

  it("does not return a stopped thread the plugin did not start", async () => {
    const { service, published, kv } = serviceWith({
      listThreads: async () => [thread("thr_branch", "env_1", 1, null, { status: "idle" })],
      resolveEnvironmentPr: async () => linkedTo("acme", "api", 15),
    });
    await service.refreshReviewQueue();
    const keys = [...kv.entries.keys()];

    await service.threadStopped("thr_branch");

    expect([...kv.entries.keys()]).toEqual(keys);
    expect(returnedOf(published.at(-1)!)).toEqual({ row: null, view: false });
  });

  it("clears a returned thread when the user opens it, and returns it after a follow-up", async () => {
    const { service, published } = serviceWith(reviewOn15());
    await service.refreshReviewQueue();
    await service.threadStopped("thr_review");

    expect(await service.markThreadOpened({ threadId: "thr_review" })).toEqual({ kind: "ok" });
    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(returnedOf(published[2]!)).toEqual({ row: null, view: false });

    await service.threadStopped("thr_review");
    await vi.waitFor(() => expect(published).toHaveLength(4));
    expect(returnedOf(published[3]!)).toEqual({ row: "finished", view: true });
  });

  it("does nothing when an opened thread was not returned", async () => {
    const { service, published, kv } = serviceWith(reviewOn15());
    await service.refreshReviewQueue();
    const keys = [...kv.entries.keys()];

    expect(await service.markThreadOpened({ threadId: "thr_other" })).toEqual({ kind: "ok" });

    await new Promise((resolve) => setImmediate(resolve));
    expect(published).toHaveLength(1);
    expect([...kv.entries.keys()]).toEqual(keys);
  });

  it("keeps a review thread with a pending question returned after it is opened", async () => {
    const { service, published, kv } = serviceWith(reviewOn15({ hasPendingInteraction: true }));
    kv.entries.set("review-returned:thr_review", { v: 1 });
    await service.refreshReviewQueue();

    await service.markThreadOpened({ threadId: "thr_review" });

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(returnedOf(published[1]!)).toEqual({ row: "needs_you", view: true });
  });

  it("counts a returned thread on a reviewed PR", async () => {
    const { service, kv } = serviceWith(reviewOn15());
    kv.entries.set(...mark("acme/api", 15, "head-15"));
    kv.entries.set("review-returned:thr_review", { v: 1 });

    const view = viewOf(await service.refreshReviewQueue());

    expect(view.needsReview).toEqual([]);
    expect(view.hasReturned).toBe(true);
  });

  it("does not count a stopped thread whose agent runs again", async () => {
    const { service, kv } = serviceWith(reviewOn15({ status: "active" }));
    kv.entries.set("review-returned:thr_review", { v: 1 });

    expect(returnedOf(await service.refreshReviewQueue())).toEqual({ row: null, view: false });
    expect(kv.entries.has("review-returned:thr_review")).toBe(true);
  });

  it("keeps returned state when a thread's metadata cannot be read", async () => {
    const { service, kv } = serviceWith({
      listReviewThreads: async () => [reviewThread("thr_review", { status: "idle" })],
      readPluginMetadata: async () => {
        throw new Error("timeout");
      },
    });
    kv.entries.set("review-returned:thr_review", { v: 1 });

    await service.refreshReviewQueue();

    expect(kv.entries.has("review-returned:thr_review")).toBe(true);
  });

  it("forgets returned state of threads that are archived", async () => {
    const { service, kv } = serviceWith(reviewOn15({ archivedAt: 5 }));
    kv.entries.set("review-returned:thr_review", { v: 1 });

    await service.refreshReviewQueue();

    expect(kv.entries.has("review-returned:thr_review")).toBe(false);
  });

  it("puts a returned review thread first, like one that needs the user", async () => {
    const { service, kv } = serviceWith({
      fetchReviewQueue: async () =>
        queueOf([
          queuePr("acme/api", 15, { updatedAt: "2026-10-02T09:55:00Z" }),
          queuePr("acme/web", 3, { updatedAt: "2026-09-30T09:00:00Z" }),
        ]),
      listReviewThreads: async () => [reviewThread("thr_review", { status: "idle" })],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/web", 3) }),
    });
    kv.entries.set("review-returned:thr_review", { v: 1 });

    expect(sections(await service.refreshReviewQueue()).needsReview).toEqual([
      ["acme/web", [3]],
      ["acme/api", [15]],
    ]);
  });
});

describe("linked thread status", () => {
  function branchThreadOn15(status: () => QueueThread["status"]) {
    return {
      listThreads: async () => [thread("thr_branch", "env_1", 1, null, { status: status() })],
      resolveEnvironmentPr: async () => linkedTo("acme", "api", 15),
    };
  }

  function statusOf(result: LoadedReviewQueue) {
    return firstReviewRequest(result).thread?.status;
  }

  it("shows a linked thread as running when the user sends it a new message", async () => {
    let status: QueueThread["status"] = "idle";
    const { service, published } = serviceWith(branchThreadOn15(() => status));
    await service.refreshReviewQueue();
    status = "active";

    await service.threadActive("thr_branch");

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(statusOf(published[1]!)).toBe("running");
  });

  it("shows a review thread as running again after a follow-up message", async () => {
    let status: QueueThread["status"] = "idle";
    const { service, published } = serviceWith({
      listReviewThreads: async () => [reviewThread("thr_review", { status })],
      readPluginMetadata: metadataOf({ thr_review: reviewPrEntry("acme/api", 15) }),
    });
    await service.refreshReviewQueue();
    await service.threadStopped("thr_review");
    status = "active";

    await service.threadActive("thr_review");

    await vi.waitFor(() => expect(published).toHaveLength(3));
    expect(firstReviewRequest(published[2]!).thread).toMatchObject({
      status: "running",
      returned: null,
    });
  });

  it("shows a linked thread the plugin did not start as idle when its agent stops", async () => {
    let status: QueueThread["status"] = "active";
    const { service, published } = serviceWith(branchThreadOn15(() => status));
    await service.refreshReviewQueue();
    status = "idle";

    await service.threadStopped("thr_branch");

    await vi.waitFor(() => expect(published).toHaveLength(2));
    expect(statusOf(published[1]!)).toBe("idle");
  });

  it("ignores a thread that no PR in the queue links to", async () => {
    const { service, published } = serviceWith(branchThreadOn15(() => "idle"));
    await service.refreshReviewQueue();

    await service.threadActive("thr_other");

    await new Promise((resolve) => setImmediate(resolve));
    expect(published).toHaveLength(1);
  });
});
