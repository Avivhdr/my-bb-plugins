import type { NewThreadRequest, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type {
  ActionResult,
  MarkNeedsReviewRequest,
  MarkQueueSeenRequest,
  MarkReviewedRequest,
} from "../contract";
import { newCommentIds } from "../core/new-comments";
import type { PullRequestRef } from "../core/pr-ref";
import { readReviewPr, type ReviewPr } from "../core/review-pr";
import {
  parseGithubRepo,
  TEAM_PR_WINDOW_MS,
  type FetchedQueue,
  type PrActivity,
  type QueueList,
} from "../core/review-queue";
import {
  isReviewed,
  loadedReviewQueueSchema,
  type LinkedQueuePr,
  type LinkedThread,
  type LoadedReviewQueue,
  type NewActivity,
  type QueueRow,
  type QueueSection,
  type ReturnedReason,
  type ReviewQueueResult,
  type ReviewQueueView,
  type ReviewThreadStatus,
} from "../core/review-queue-view";
import { reviewState } from "../core/review-state";
import type { TeamScan, TeamScanRequest } from "../core/team-prs";
import type { PrResolution } from "../pr-lookup";
import { isSharedEnvironment } from "./review-environment";
import { createReturnedThreads } from "./returned-threads";
import { createReviewedMarks, type ReviewedMark } from "./reviewed-marks";
import { createSeenComments } from "./seen-comments";
import { createSeenPrs } from "./seen-prs";
import { createTeamPrs, type TeamPrs } from "./team-prs";

export const NO_HOST_MESSAGE = "No host available";
export const NOT_A_REVIEW_THREAD_MESSAGE = "This thread is not a review thread";
export const SHARED_ENVIRONMENT_MESSAGE = "Review threads need a new worktree";
export const INVALID_REPOSITORY_MESSAGE = "Repository must be owner/name";
export const REVIEW_QUEUE_INTERVAL_MS = 5 * 60_000;
export const REVIEW_QUEUE_STORAGE_KEY = "review-queue";
export const TEAM_SCAN_OVERLAP_MS = 10 * 60_000;

export interface QueueProject {
  id: string;
  kind: "personal" | "standard";
  gitRemoteUrl: string | null;
  updatedAt: number;
}

export interface QueueThread {
  id: string;
  environmentId: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
  status: "error" | "active" | "idle" | "pending" | "starting" | "stopping";
  hasPendingInteraction: boolean;
}

export interface ReviewQueueServiceDeps {
  primaryHostId(): Promise<string | null>;
  fetchReviewQueue(hostId: string, tracked: PullRequestRef[]): Promise<FetchedQueue>;
  scanTeamPrs(hostId: string, request: TeamScanRequest): Promise<TeamScan>;
  listProjects(): Promise<QueueProject[]>;
  listThreads(): Promise<QueueThread[]>;
  listReviewThreads(): Promise<QueueThread[]>;
  readPluginMetadata(threadId: string): Promise<unknown>;
  spawnReviewThread(pr: ReviewPr, request: NewThreadRequest): Promise<string>;
  archiveThread(threadId: string): Promise<void>;
  resolveEnvironmentPr(environmentId: string): Promise<PrResolution>;
  kv: Pick<PluginKvStorage, "get" | "set" | "delete" | "list">;
  publish(result: LoadedReviewQueue): void;
  warn(message: string): void;
  now(): number;
}

interface StartedReview {
  thread: QueueThread;
  pr: ReviewPr;
}

interface LinkedView {
  view: ReviewQueueView;
  stale: { returnedThreadIds: string[]; seenKeys: string[] };
}

function prKey(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}

function refKey({ owner, repo, number }: PullRequestRef): string {
  return prKey(`${owner}/${repo}`, number);
}

function refOf(repo: string, number: number): PullRequestRef | null {
  const [owner, name, ...rest] = repo.split("/");
  if (!owner || !name || rest.length > 0) return null;
  return { owner, repo: name, number };
}

function uniqueRefs(refs: readonly (PullRequestRef | null)[]): PullRequestRef[] {
  const byKey = new Map<string, PullRequestRef>();
  for (const ref of refs) {
    if (ref !== null && !byKey.has(refKey(ref))) byKey.set(refKey(ref), ref);
  }
  return [...byKey.values()];
}

function trackedRefsOf(
  marked: readonly ReviewedMark[],
  reviews: readonly StartedReview[],
  team: TeamPrs,
): PullRequestRef[] {
  return uniqueRefs([
    ...marked.map((mark) => mark.ref),
    ...reviews.map(({ pr }) => refOf(pr.repo, pr.number)),
    ...team.refs,
  ]);
}

function withMoreTracked(fetched: FetchedQueue, more: FetchedQueue): FetchedQueue {
  return {
    requests: fetched.requests,
    tracked: [...fetched.tracked, ...more.tracked],
    gone: [...fetched.gone, ...more.gone],
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function threadStatus(thread: QueueThread): ReviewThreadStatus {
  if (thread.hasPendingInteraction) return "needs_you";
  if (thread.status === "idle") return "idle";
  if (thread.status === "error") return "error";
  return "running";
}

const storedReviewQueueSchema = z.object({ v: z.literal(5), result: loadedReviewQueueSchema });

function viewOf(result: LoadedReviewQueue): ReviewQueueView | null {
  if (result.kind === "error") return result.lastGood;
  const { kind: _, ...view } = result;
  return view;
}

function rowsOf(view: ReviewQueueView): QueueRow[] {
  return [...view.needsReview, ...view.reviewed].flatMap((group) =>
    group.prs.map(({ projectIds: _, review: __, newActivity: ___, thread: ____, ...row }) => row),
  );
}

function mergeRows({ requests, tracked }: FetchedQueue): QueueRow[] {
  const trackedByKey = new Map(tracked.map((pr) => [prKey(pr.repo, pr.number), pr]));
  const rows = requests.groups.flatMap((group) =>
    group.prs.map((pr) => ({
      ...pr,
      activity: trackedByKey.get(prKey(pr.repo, pr.number))?.activity ?? null,
      requested: true,
    })),
  );
  const keys = new Set(rows.map((row) => prKey(row.repo, row.number)));
  for (const pr of tracked) {
    const key = prKey(pr.repo, pr.number);
    if (keys.has(key)) continue;
    keys.add(key);
    rows.push({ ...pr, requested: false });
  }
  return rows;
}

function newActivitySince(
  activity: PrActivity | null,
  markedAt: number,
  seenComments: ReadonlySet<string>,
): NewActivity[] {
  if (activity === null) return [];
  const isAfterMark = (at: string | null) => at !== null && Date.parse(at) > markedAt;
  const comments = [...activity.conversationComments, ...activity.inlineComments];
  const hasNewComments = newCommentIds(comments, markedAt, seenComments).length > 0;
  return [
    ...(hasNewComments ? (["new_comments"] as const) : []),
    ...(isAfterMark(activity.lastRequestedAt) ? (["requested_again"] as const) : []),
  ];
}

function returnedReason(status: ReviewThreadStatus, stopped: boolean): ReturnedReason | null {
  if (status === "needs_you") return "needs_you";
  if (!stopped) return null;
  if (status === "idle") return "finished";
  if (status === "error") return "failed";
  return null;
}

function needsYou(pr: LinkedQueuePr): boolean {
  return pr.thread?.status === "needs_you" || pr.thread?.returned != null;
}

function byAttentionThenUpdate(a: LinkedQueuePr, b: LinkedQueuePr): number {
  return (
    Number(needsYou(b)) - Number(needsYou(a)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)
  );
}

function sectionOf(prs: LinkedQueuePr[]): QueueSection {
  const byRepo = new Map<string, LinkedQueuePr[]>();
  for (const pr of prs) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr]);
  return [...byRepo]
    .map(([repo, group]) => ({
      repo,
      prs: group.sort(byAttentionThenUpdate),
      attention: group.some(needsYou),
    }))
    .sort((a, b) => Number(b.attention) - Number(a.attention) || a.repo.localeCompare(b.repo))
    .map(({ repo, prs: group }) => ({ repo, prs: group }));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export function createReviewQueueService(deps: ReviewQueueServiceDeps) {
  const marks = createReviewedMarks(deps.kv, deps.now);
  const seenPrs = createSeenPrs(deps.kv);
  const returnedThreads = createReturnedThreads(deps.kv);
  const seenComments = createSeenComments(deps.kv);
  const teamPrs = createTeamPrs(deps.kv);
  let running: Promise<LoadedReviewQueue> | null = null;
  let queued: Promise<LoadedReviewQueue> | null = null;

  async function readStored(): Promise<LoadedReviewQueue | null> {
    const parsed = storedReviewQueueSchema.safeParse(await deps.kv.get(REVIEW_QUEUE_STORAGE_KEY));
    return parsed.success ? parsed.data.result : null;
  }

  async function store(result: LoadedReviewQueue): Promise<void> {
    await deps.kv.set(REVIEW_QUEUE_STORAGE_KEY, { v: 5, result });
    deps.publish(result);
  }

  async function projectIdsByRepo(): Promise<Map<string, string[]>> {
    const projects = (await deps.listProjects())
      .filter((project) => project.kind === "standard")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const byRepo = new Map<string, string[]>();
    for (const project of projects) {
      const repo = parseGithubRepo(project.gitRemoteUrl);
      if (repo !== null) byRepo.set(repo, [...(byRepo.get(repo) ?? []), project.id]);
    }
    return byRepo;
  }

  async function readStartedReview(thread: QueueThread): Promise<StartedReview | null> {
    const pr = readReviewPr(await deps.readPluginMetadata(thread.id).catch(() => null));
    return pr === null ? null : { thread, pr };
  }

  async function liveReviewThreads(): Promise<QueueThread[]> {
    return (await deps.listReviewThreads()).filter((thread) => thread.archivedAt === null);
  }

  async function startedReviews(threads: QueueThread[]): Promise<StartedReview[]> {
    const reviews = await Promise.all(threads.map(readStartedReview));
    return reviews.filter((review) => review !== null);
  }

  async function isStartedReview(threadId: string): Promise<boolean> {
    return readReviewPr(await deps.readPluginMetadata(threadId)) !== null;
  }

  async function threadsByPr(reviews: StartedReview[]): Promise<Map<string, QueueThread>> {
    const threads = (await deps.listThreads())
      .filter((thread) => thread.archivedAt === null && thread.environmentId !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const resolutions = new Map<string, Promise<PrResolution>>();
    const resolve = (environmentId: string) => {
      if (!resolutions.has(environmentId)) {
        resolutions.set(
          environmentId,
          deps.resolveEnvironmentPr(environmentId).catch((): PrResolution => ({ kind: "no_pr" })),
        );
      }
      return resolutions.get(environmentId)!;
    };
    const linked = await Promise.all(
      threads.map(async (thread) => ({ thread, resolution: await resolve(thread.environmentId!) })),
    );
    const links = [
      ...linked.flatMap(({ thread, resolution }) =>
        resolution.kind === "pr" ? [{ key: refKey(resolution.target.ref), thread }] : [],
      ),
      ...reviews.map(({ thread, pr }) => ({ key: prKey(pr.repo, pr.number), thread })),
    ].sort((a, b) => b.thread.updatedAt - a.thread.updatedAt);
    const byPr = new Map<string, QueueThread>();
    for (const { key, thread } of links) {
      if (!byPr.has(key)) byPr.set(key, thread);
    }
    return byPr;
  }

  async function linkView(
    rows: QueueRow[],
    truncated: boolean,
    loadedAt: number,
  ): Promise<LinkedView> {
    const loadingLive = liveReviewThreads();
    const loadingReviews = loadingLive.then(startedReviews);
    const loadingMarks = marks.list();
    const [projectIds, live, reviews, threads, marked, seenByPr, seen, returned, team] =
      await Promise.all([
        projectIdsByRepo(),
        loadingLive,
        loadingReviews,
        loadingReviews.then(threadsByPr),
        loadingMarks,
        loadingMarks.then(seenCommentsByPr),
        seenPrs.list(),
        returnedThreads.list(),
        teamPrs.read(),
      ]);
    const marksByPr = new Map(marked.map((mark) => [refKey(mark.ref), mark]));
    const reviewThreadIds = new Set(reviews.map(({ thread }) => thread.id));
    const liveIds = new Set(live.map(({ id }) => id));
    const tracked = new Set(trackedRefsOf(marked, reviews, team).map(refKey));
    const linkThread = (thread: QueueThread | undefined): LinkedThread | null => {
      if (thread === undefined) return null;
      const status = threadStatus(thread);
      const isReviewThread = reviewThreadIds.has(thread.id);
      return {
        id: thread.id,
        status,
        isReviewThread,
        returned: isReviewThread ? returnedReason(status, returned.has(thread.id)) : null,
      };
    };
    const linked = rows.flatMap((row): LinkedQueuePr[] => {
      const key = prKey(row.repo, row.number);
      const mark = marksByPr.get(key);
      if (!row.requested && !tracked.has(key)) return [];
      return [
        {
          ...row,
          projectIds: projectIds.get(row.repo.toLowerCase()) ?? [],
          review: reviewState(mark?.headOid ?? null, row.headOid),
          newActivity:
            mark === undefined
              ? []
              : newActivitySince(row.activity, mark.markedAt, seenByPr.get(key) ?? new Set()),
          thread: linkThread(threads.get(key)),
        },
      ];
    });
    const needsReview = linked.filter((pr) => !isReviewed(pr));
    const needsReviewKeys = new Set(needsReview.map((pr) => prKey(pr.repo, pr.number)));
    return {
      view: {
        needsReview: sectionOf(needsReview),
        reviewed: sectionOf(linked.filter(isReviewed)),
        truncated,
        loadedAt,
        hasUnseen: [...needsReviewKeys].some((key) => !seen.has(key)),
        hasReturned: linked.some((pr) => pr.thread?.returned != null),
      },
      stale: {
        returnedThreadIds: [...returned].filter((id) => !liveIds.has(id)),
        seenKeys: [...seen].filter((key) => !needsReviewKeys.has(key)),
      },
    };
  }

  async function seenCommentsByPr(marked: ReviewedMark[]): Promise<Map<string, Set<string>>> {
    return new Map(
      await Promise.all(
        marked.map(async (mark) => [refKey(mark.ref), await seenComments.get(mark.ref)] as const),
      ),
    );
  }

  async function trackedRefs(team: TeamPrs): Promise<PullRequestRef[]> {
    const [marked, reviews] = await Promise.all([
      marks.list(),
      liveReviewThreads().then(startedReviews),
    ]);
    return trackedRefsOf(marked, reviews, team);
  }

  async function discoverTeamPrs(
    hostId: string,
    requests: QueueList,
    team: TeamPrs,
    tracked: readonly PullRequestRef[],
  ): Promise<PullRequestRef[]> {
    const repos = new Set([
      ...requests.groups.map((group) => group.repo.toLowerCase()),
      ...team.refs.map(({ owner, repo }) => `${owner}/${repo}`.toLowerCase()),
    ]);
    if (repos.size === 0) return [];
    const startedAt = deps.now();
    const sinceOf = (through: string | undefined) =>
      new Date(
        through === undefined
          ? startedAt - TEAM_PR_WINDOW_MS
          : Date.parse(through) - TEAM_SCAN_OVERLAP_MS,
      ).toISOString();
    try {
      const scan = await deps.scanTeamPrs(hostId, {
        repos: [...repos].map((repo) => ({ repo, since: sinceOf(team.scannedThrough[repo]) })),
        startedAt: new Date(startedAt).toISOString(),
      });
      await teamPrs.recordScan(scan);
      const known = new Set(tracked.map(refKey));
      return uniqueRefs(scan.refs).filter((ref) => !known.has(refKey(ref)));
    } catch (error) {
      deps.warn(`Team pull request scan failed: ${errorText(error)}`);
      return [];
    }
  }

  async function deleteEach<T>(
    items: T[],
    remove: (item: T) => Promise<void>,
    describe: (item: T) => string,
  ): Promise<void> {
    await Promise.all(
      items.map((item) =>
        remove(item).catch((error) =>
          deps.warn(`Could not delete ${describe(item)}: ${errorText(error)}`),
        ),
      ),
    );
  }

  async function forgetStale({ returnedThreadIds, seenKeys }: LinkedView["stale"]): Promise<void> {
    await Promise.all([
      deleteEach(returnedThreadIds, returnedThreads.delete, (id) => `returned thread ${id}`),
      seenKeys.length === 0
        ? undefined
        : seenPrs
            .remove(seenKeys)
            .catch((error) => deps.warn(`Could not prune seen PRs: ${errorText(error)}`)),
    ]);
  }

  async function linkAndForget(
    rows: QueueRow[],
    truncated: boolean,
    loadedAt: number,
  ): Promise<ReviewQueueView> {
    const { view, stale } = await linkView(rows, truncated, loadedAt);
    await forgetStale(stale);
    return view;
  }

  async function load(): Promise<ReviewQueueView> {
    const hostId = await deps.primaryHostId();
    if (hostId === null) throw new Error(NO_HOST_MESSAGE);
    const team = await teamPrs.read();
    const tracked = await trackedRefs(team);
    const fetched = await deps.fetchReviewQueue(hostId, tracked);
    const found = await discoverTeamPrs(hostId, fetched.requests, team, tracked);
    const all =
      found.length === 0
        ? fetched
        : withMoreTracked(fetched, await deps.fetchReviewQueue(hostId, found));
    await Promise.all([
      deleteEach(all.gone, marks.delete, (ref) => `the reviewed mark of ${refKey(ref)}`),
      teamPrs
        .remove(all.gone)
        .catch((error) => deps.warn(`Could not prune team PRs: ${errorText(error)}`)),
    ]);
    return linkAndForget(mergeRows(all), all.requests.truncated, deps.now());
  }

  async function runLoad(): Promise<LoadedReviewQueue> {
    let result: LoadedReviewQueue;
    try {
      result = { kind: "ok", ...(await load()) };
    } catch (error) {
      const previous = await readStored().catch(() => null);
      result = { kind: "error", message: errorText(error), lastGood: previous && viewOf(previous) };
    }
    await store(result).catch((error) =>
      deps.warn(`Review queue store failed: ${errorText(error)}`),
    );
    return result;
  }

  function refreshReviewQueue(): Promise<LoadedReviewQueue> {
    if (running === null) {
      running = runLoad().finally(() => {
        running = null;
      });
      return running;
    }
    queued ??= running.then(() => {
      queued = null;
      return refreshReviewQueue();
    });
    return queued;
  }

  async function getReviewQueue(): Promise<ReviewQueueResult> {
    return (await readStored()) ?? { kind: "loading" };
  }

  let relinking: Promise<void> = Promise.resolve();

  function relink(): Promise<void> {
    relinking = relinking.then(relinkOnce);
    return relinking;
  }

  async function relinkOnce(): Promise<void> {
    try {
      await running;
      const stored = await readStored();
      const view = stored && viewOf(stored);
      if (stored === null || view === null) return;
      const next = await linkAndForget(rowsOf(view), view.truncated, view.loadedAt);
      // A load that finished meanwhile has newer GitHub data; keep it over this re-link.
      const current = await readStored();
      if (current === null || viewOf(current)?.loadedAt !== view.loadedAt) return;
      await store(current.kind === "ok" ? { kind: "ok", ...next } : { ...current, lastGood: next });
    } catch (error) {
      deps.warn(`Review queue update failed: ${errorText(error)}`);
    }
  }

  async function startReview(pr: ReviewPr, request: NewThreadRequest): Promise<string> {
    if (isSharedEnvironment(request.environment)) throw new Error(SHARED_ENVIRONMENT_MESSAGE);
    const threadId = await deps.spawnReviewThread(pr, request);
    void relink();
    return threadId;
  }

  async function archiveReview(threadId: string): Promise<ActionResult> {
    try {
      if (!(await isStartedReview(threadId))) {
        return { kind: "error", message: NOT_A_REVIEW_THREAD_MESSAGE };
      }
      await deps.archiveThread(threadId);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    void relink();
    return { kind: "ok" };
  }

  async function isListed(ref: PullRequestRef): Promise<boolean> {
    const stored = await readStored();
    const view = stored && viewOf(stored);
    return view !== null && rowsOf(view).some((row) => prKey(row.repo, row.number) === refKey(ref));
  }

  async function forgetSeenComments(ref: PullRequestRef): Promise<void> {
    try {
      await seenComments.delete(ref);
    } catch (error) {
      deps.warn(`Could not delete seen comments of ${refKey(ref)}: ${errorText(error)}`);
    }
  }

  async function markReviewed({
    repo,
    number,
    headOid,
  }: MarkReviewedRequest): Promise<ActionResult> {
    const ref = refOf(repo, number);
    if (ref === null) return { kind: "error", message: INVALID_REPOSITORY_MESSAGE };
    try {
      await marks.save(ref, headOid);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    await forgetSeenComments(ref);
    if (await isListed(ref).catch(() => false)) await relink();
    else void refreshReviewQueue();
    return { kind: "ok" };
  }

  async function markNeedsReview({ repo, number }: MarkNeedsReviewRequest): Promise<ActionResult> {
    const ref = refOf(repo, number);
    if (ref === null) return { kind: "error", message: INVALID_REPOSITORY_MESSAGE };
    try {
      await marks.delete(ref);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    await forgetSeenComments(ref);
    await relink();
    return { kind: "ok" };
  }

  async function markQueueSeen({ prs }: MarkQueueSeenRequest): Promise<ActionResult> {
    try {
      await seenPrs.replace(prs.map((pr) => prKey(pr.repo, pr.number)));
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    await relink();
    return { kind: "ok" };
  }

  async function newCommentBasis(
    ref: PullRequestRef,
  ): Promise<{ markedAt: number | null; seen: Set<string> }> {
    const [mark, seen] = await Promise.all([marks.get(ref), seenComments.get(ref)]);
    return { markedAt: mark?.markedAt ?? null, seen };
  }

  async function markCommentsSeen(
    ref: PullRequestRef,
    ids: readonly string[],
  ): Promise<ActionResult> {
    try {
      await seenComments.add(ref, ids);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    await relink();
    return { kind: "ok" };
  }

  async function isLinked(threadId: string): Promise<boolean> {
    const stored = await readStored();
    const view = stored && viewOf(stored);
    if (!view) return false;
    return [...view.needsReview, ...view.reviewed].some((group) =>
      group.prs.some((pr) => pr.thread?.id === threadId),
    );
  }

  async function threadActive(threadId: string): Promise<void> {
    try {
      if (!(await isLinked(threadId))) return;
    } catch (error) {
      deps.warn(`Could not read the review queue for thread ${threadId}: ${errorText(error)}`);
      return;
    }
    await relink();
  }

  async function threadStopped(threadId: string): Promise<void> {
    try {
      if (await isStartedReview(threadId)) await returnedThreads.add(threadId);
      else if (!(await isLinked(threadId))) return;
    } catch (error) {
      deps.warn(`Could not record stopped review thread ${threadId}: ${errorText(error)}`);
      return;
    }
    await relink();
  }

  async function markThreadOpened({ threadId }: { threadId: string }): Promise<ActionResult> {
    try {
      if (!(await returnedThreads.has(threadId))) return { kind: "ok" };
      await returnedThreads.delete(threadId);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    await relink();
    return { kind: "ok" };
  }

  async function run(signal: AbortSignal): Promise<void> {
    const aborted = new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    while (!signal.aborted) {
      await Promise.race([refreshReviewQueue(), aborted]);
      if (signal.aborted) return;
      await sleep(REVIEW_QUEUE_INTERVAL_MS, signal);
    }
  }

  return {
    getReviewQueue,
    refreshReviewQueue,
    startReview,
    archiveReview,
    markReviewed,
    markNeedsReview,
    markQueueSeen,
    newCommentBasis,
    markCommentsSeen,
    threadActive,
    threadStopped,
    markThreadOpened,
    run,
  };
}
