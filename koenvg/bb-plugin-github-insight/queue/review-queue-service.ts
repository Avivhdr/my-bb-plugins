import type { NewThreadRequest, PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type {
  ActionResult,
  AutoReviewSettings,
  MarkNeedsReviewRequest,
  MarkQueueSeenRequest,
  MarkReviewedRequest,
  PrRefRequest,
  ReReviewRequest,
  RepoVisibilityRequest,
  TeammatesTeamRequest,
  ViewerTeamsResult,
} from "../contract";
import { newCommentIds } from "../core/new-comments";
import type { PullRequestRef } from "../core/pr-ref";
import {
  keepsAuthor,
  layerSearchQuery,
  setRepoHidden,
  skipLabelOf,
  type ReviewFilters,
  type ReviewLayer,
} from "../core/review-filters";
import { readReviewPr, type ReviewPr } from "../core/review-pr";
import { buildReReviewPrompt, buildReviewPrompt } from "../core/review-prompt";
import {
  CLOSED_PR_WINDOW_MS,
  parseGithubRepo,
  type FetchedQueue,
  type PrActivity,
} from "../core/review-queue";
import {
  countedPrs,
  isReviewed,
  loadedReviewQueueSchema,
  viewPrs,
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
import type { ViewerTeam } from "../core/teams";
import type { PrResolution } from "../pr-lookup";
import {
  autoReviewRequest,
  createAutoReviewSettings,
  createAutoStarted,
  isAutoReReviewCandidate,
  isAutoReviewCandidate,
  isBusy,
  type ReviewThreadRequest,
} from "./auto-review";
import { createIgnoredPrs } from "./ignored-prs";
import { isSharedEnvironment } from "./review-environment";
import { createReReviews, type SentReReview } from "./re-reviews";
import { createReturnedThreads } from "./returned-threads";
import { createReviewFiltersStore } from "./review-filters";
import { createReviewedMarks, type ReviewedMark } from "./reviewed-marks";
import { createSeenComments } from "./seen-comments";
import { createSeenPrs } from "./seen-prs";

export const NO_HOST_MESSAGE = "No host available";
export const NOT_A_REVIEW_THREAD_MESSAGE = "This thread is not a review thread";
export const SHARED_ENVIRONMENT_MESSAGE = "Review threads need a new worktree";
export const INVALID_REPOSITORY_MESSAGE = "Repository must be owner/name";
export const NOT_REVIEWED_MESSAGE = "This PR has no earlier review to compare with";
export const REVIEW_QUEUE_INTERVAL_MS = 5 * 60_000;
export const REVIEW_QUEUE_STORAGE_KEY = "review-queue";
/** Written by the team PR scan of earlier versions. */
const TEAM_PRS_STORAGE_KEY = "team-prs";

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
  fetchReviewQueue(
    hostId: string,
    layerQueries: string[],
    tracked: PullRequestRef[],
  ): Promise<FetchedQueue>;
  /** Lowercase logins of the members of an `org/slug` team. */
  fetchTeamMembers(hostId: string, team: string): Promise<string[]>;
  listViewerTeams(hostId: string): Promise<ViewerTeam[]>;
  listProjects(): Promise<QueueProject[]>;
  listThreads(): Promise<QueueThread[]>;
  listReviewThreads(): Promise<QueueThread[]>;
  readPluginMetadata(threadId: string): Promise<unknown>;
  spawnReviewThread(pr: ReviewPr, request: ReviewThreadRequest): Promise<string>;
  archiveThread(threadId: string): Promise<void>;
  sendMessage(threadId: string, text: string): Promise<unknown>;
  /** The "How to review" text of the re-review prompt, from the plugin settings. */
  reReviewInstructions(): Promise<string>;
  /** The editable part of the review prompt, from the plugin settings. */
  reviewInstructions(): Promise<string>;
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
  stale: {
    returnedThreadIds: string[];
    seenKeys: string[];
    ignoredKeys: string[];
    expiredMarks: PullRequestRef[];
    autoStartedKeys: string[];
  };
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
): PullRequestRef[] {
  return uniqueRefs([
    ...marked.map((mark) => mark.ref),
    ...reviews.map(({ pr }) => refOf(pr.repo, pr.number)),
  ]);
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

const storedReviewQueueSchema = z.object({ v: z.literal(6), result: loadedReviewQueueSchema });

function viewOf(result: LoadedReviewQueue): ReviewQueueView | null {
  if (result.kind === "error") return result.lastGood;
  const { kind: _, ...view } = result;
  return view;
}

function rowsOf(view: ReviewQueueView): QueueRow[] {
  return viewPrs(view).map(
    ({
      projectIds: _,
      review: __,
      newActivity: ___,
      thread: ____,
      skipLabel: _____,
      ignored: ______,
      ...row
    }) => row,
  );
}

function truncatedLayersOf(view: ReviewQueueView): Set<string> {
  return new Set(view.layers.filter((layer) => layer.truncated).map((layer) => layer.name));
}

/**
 * Each PR once: the first layer that found it and keeps its author wins, then the tracked PRs
 * no layer found. `fetched.layers` lines up with `layers`.
 */
function mergeRows(
  { layers: found, tracked }: FetchedQueue,
  layers: readonly ReviewLayer[],
  teammates: ReadonlySet<string> | null,
): QueueRow[] {
  const trackedByKey = new Map(tracked.map((pr) => [prKey(pr.repo, pr.number), pr]));
  const rows: QueueRow[] = [];
  const keys = new Set<string>();
  layers.forEach((layer, index) => {
    for (const pr of found[index]?.prs ?? []) {
      const key = prKey(pr.repo, pr.number);
      if (keys.has(key) || !keepsAuthor(layer, pr.author, teammates)) continue;
      keys.add(key);
      rows.push({ ...pr, activity: trackedByKey.get(key)?.activity ?? null, layer: layer.name });
    }
  });
  for (const pr of tracked) {
    const key = prKey(pr.repo, pr.number);
    if (keys.has(key)) continue;
    keys.add(key);
    rows.push({ ...pr, layer: null });
  }
  return rows;
}

function isHiddenFrom(filters: ReviewFilters, layerName: string, repo: string): boolean {
  const key = repo.toLowerCase();
  const layer = filters.layers.find((entry) => entry.name === layerName);
  return (
    layer === undefined || filters.excludeRepos.includes(key) || layer.excludeRepos.includes(key)
  );
}

function closedBefore(row: QueueRow, at: number): boolean {
  return row.state !== "open" && (row.closedAt === null || Date.parse(row.closedAt) < at);
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

/**
 * Whether Re-review has something to send: changes since the review, and, after an earlier
 * re-review, a new commit or new activity since that one.
 */
function reReviewDue(
  row: QueueRow,
  mark: ReviewedMark,
  sent: SentReReview | undefined,
  seenComments: ReadonlySet<string>,
): boolean {
  const since = sent !== undefined && sent.sentAt > mark.markedAt ? sent : null;
  if (since === null) {
    return (
      mark.headOid !== row.headOid ||
      newActivitySince(row.activity, mark.markedAt, seenComments).length > 0
    );
  }
  return (
    since.headOid !== row.headOid ||
    newActivitySince(row.activity, since.sentAt, seenComments).length > 0
  );
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

/** Skipped PRs last, then the PRs whose thread needs you, then the oldest PR first. */
function byAttentionThenAge(a: LinkedQueuePr, b: LinkedQueuePr): number {
  return (
    Number(a.skipLabel !== null) - Number(b.skipLabel !== null) ||
    Number(needsYou(b)) - Number(needsYou(a)) ||
    Date.parse(a.createdAt) - Date.parse(b.createdAt)
  );
}

function sectionOf(prs: LinkedQueuePr[]): QueueSection {
  const byRepo = new Map<string, LinkedQueuePr[]>();
  for (const pr of prs) byRepo.set(pr.repo, [...(byRepo.get(pr.repo) ?? []), pr]);
  const oldest = (group: LinkedQueuePr[]) =>
    Math.min(...group.map((pr) => Date.parse(pr.createdAt)));
  return [...byRepo]
    .map(([repo, group]) => ({
      repo,
      prs: group.sort(byAttentionThenAge),
      attention: group.some(needsYou),
      oldest: oldest(group),
    }))
    .sort(
      (a, b) =>
        Number(b.attention) - Number(a.attention) ||
        a.oldest - b.oldest ||
        a.repo.localeCompare(b.repo),
    )
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
  const filtersStore = createReviewFiltersStore(deps.kv);
  const ignoredPrs = createIgnoredPrs(deps.kv);
  const reReviews = createReReviews(deps.kv, deps.now);
  const autoReview = createAutoReviewSettings(deps.kv);
  const autoStarted = createAutoStarted(deps.kv);
  let running: Promise<LoadedReviewQueue> | null = null;
  let queued: Promise<LoadedReviewQueue> | null = null;

  async function readStored(): Promise<LoadedReviewQueue | null> {
    const parsed = storedReviewQueueSchema.safeParse(await deps.kv.get(REVIEW_QUEUE_STORAGE_KEY));
    return parsed.success ? parsed.data.result : null;
  }

  async function store(result: LoadedReviewQueue): Promise<void> {
    await deps.kv.set(REVIEW_QUEUE_STORAGE_KEY, { v: 6, result });
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
    truncatedLayers: ReadonlySet<string>,
    loadedAt: number,
    teammatesError: string | null,
  ): Promise<LinkedView> {
    const loadingLive = liveReviewThreads();
    const loadingReviews = loadingLive.then(startedReviews);
    const loadingMarks = marks.list();
    const [
      projectIds,
      live,
      reviews,
      threads,
      marked,
      seenByPr,
      seen,
      returned,
      filters,
      ignored,
      sentReReviews,
      autoSettings,
      started,
    ] = await Promise.all([
      projectIdsByRepo(),
      loadingLive,
      loadingReviews,
      loadingReviews.then(threadsByPr),
      loadingMarks,
      loadingMarks.then(seenCommentsByPr),
      seenPrs.list(),
      returnedThreads.list(),
      filtersStore.read(),
      ignoredPrs.list(),
      reReviews.list(),
      autoReview.get(),
      autoStarted.list(),
    ]);
    const marksByPr = new Map(marked.map((mark) => [refKey(mark.ref), mark]));
    const reReviewsByPr = new Map(sentReReviews.map((sent) => [refKey(sent.ref), sent]));
    const reviewThreadIds = new Set(reviews.map(({ thread }) => thread.id));
    const reviewedPrs = new Set(reviews.map(({ pr }) => prKey(pr.repo, pr.number)));
    const liveIds = new Set(live.map(({ id }) => id));
    const tracked = new Set(trackedRefsOf(marked, reviews).map(refKey));
    const expiredBefore = loadedAt - CLOSED_PR_WINDOW_MS;
    const expiredMarks: PullRequestRef[] = [];
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
      const layer =
        row.layer !== null && !isHiddenFrom(filters, row.layer, row.repo) ? row.layer : null;
      if (layer === null && !tracked.has(key)) return [];
      // A merged or closed PR stays while its review thread is open, else for 7 days.
      if (closedBefore(row, expiredBefore) && !reviewedPrs.has(key)) {
        const ref = refOf(row.repo, row.number);
        if (mark !== undefined && ref !== null) expiredMarks.push(ref);
        return [];
      }
      const seenComments = seenByPr.get(key) ?? new Set<string>();
      const thread = linkThread(threads.get(key));
      const pr: LinkedQueuePr = {
        ...row,
        layer,
        projectIds: projectIds.get(row.repo.toLowerCase()) ?? [],
        review: reviewState(mark?.headOid ?? null, row.headOid),
        newActivity:
          mark === undefined ? [] : newActivitySince(row.activity, mark.markedAt, seenComments),
        thread,
        reReview:
          mark !== undefined &&
          thread?.isReviewThread === true &&
          reReviewDue(row, mark, reReviewsByPr.get(key), seenComments),
        skipLabel: skipLabelOf(row.labels, filters.skipLabels),
        ignored: row.state === "open" && ignored.has(key),
        autoQueued: false,
        autoReReview: false,
      };
      pr.autoQueued = autoSettings.enabled && !started.has(key) && isAutoReviewCandidate(pr);
      if (autoSettings.enabled && mark !== undefined) {
        const sentAt = reReviewsByPr.get(key)?.sentAt ?? 0;
        pr.autoReReview = isAutoReReviewCandidate(pr, Math.max(mark.markedAt, sentAt));
      }
      return [pr];
    });
    const merged = linked.filter((pr) => pr.state !== "open");
    const open = linked.filter((pr) => pr.state === "open" && !pr.ignored);
    const reviewed = open.filter((pr) => isReviewed(pr) || pr.layer === null);
    const layers = filters.layers.map((layer) => {
      const prs = open.filter((pr) => pr.layer === layer.name && !isReviewed(pr));
      const section = sectionOf(prs);
      return {
        name: layer.name,
        prs: section,
        count: prs.filter((pr) => pr.skipLabel === null).length,
        truncated: truncatedLayers.has(layer.name),
        hiddenRepos: layer.excludeRepos,
        teammates: layer.teammates,
      };
    });
    const waitingKeys = new Set(layers.flatMap(countedPrs).map((pr) => prKey(pr.repo, pr.number)));
    const rowKeys = new Set(rows.map((row) => prKey(row.repo, row.number)));
    return {
      view: {
        layers,
        reviewed: sectionOf(reviewed),
        merged: sectionOf(merged),
        ignored: sectionOf(linked.filter((pr) => pr.ignored)),
        hiddenEverywhere: filters.excludeRepos,
        teammatesTeam: filters.teammatesTeam,
        teammatesError,
        loadedAt,
        hasUnseen: [...waitingKeys].some((key) => !seen.has(key)),
        hasReturned: linked.some((pr) => pr.thread?.returned != null),
      },
      stale: {
        returnedThreadIds: [...returned].filter((id) => !liveIds.has(id)),
        seenKeys: [...seen].filter((key) => !waitingKeys.has(key)),
        // A truncated layer may still list an ignored PR past its first 50.
        ignoredKeys:
          truncatedLayers.size > 0 ? [] : [...ignored].filter((key) => !rowKeys.has(key)),
        expiredMarks,
        // A PR that left every list has closed or no longer asks for you; it never starts again.
        autoStartedKeys:
          truncatedLayers.size > 0 ? [] : [...started].filter((key) => !rowKeys.has(key)),
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

  async function trackedRefs(): Promise<PullRequestRef[]> {
    const [marked, reviews] = await Promise.all([
      marks.list(),
      liveReviewThreads().then(startedReviews),
    ]);
    return trackedRefsOf(marked, reviews);
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

  async function forgetStale({
    returnedThreadIds,
    seenKeys,
    ignoredKeys,
    expiredMarks,
    autoStartedKeys,
  }: LinkedView["stale"]): Promise<void> {
    await Promise.all([
      deleteEach(returnedThreadIds, returnedThreads.delete, (id) => `returned thread ${id}`),
      deleteEach(expiredMarks, marks.delete, (ref) => `the reviewed mark of ${refKey(ref)}`),
      deleteEach(expiredMarks, reReviews.delete, (ref) => `the re-review of ${refKey(ref)}`),
      deleteEach(autoStartedKeys, autoStarted.delete, (key) => `the auto-review of ${key}`),
      seenKeys.length === 0
        ? undefined
        : seenPrs
            .remove(seenKeys)
            .catch((error) => deps.warn(`Could not prune seen PRs: ${errorText(error)}`)),
      ignoredKeys.length === 0
        ? undefined
        : ignoredPrs
            .remove(ignoredKeys)
            .catch((error) => deps.warn(`Could not prune ignored PRs: ${errorText(error)}`)),
    ]);
  }

  async function linkAndForget(
    rows: QueueRow[],
    truncatedLayers: ReadonlySet<string>,
    loadedAt: number,
    teammatesError: string | null,
  ): Promise<ReviewQueueView> {
    const { view, stale } = await linkView(rows, truncatedLayers, loadedAt, teammatesError);
    await forgetStale(stale);
    return view;
  }

  async function load(): Promise<ReviewQueueView> {
    const hostId = await deps.primaryHostId();
    if (hostId === null) throw new Error(NO_HOST_MESSAGE);
    const [filters, tracked] = await Promise.all([filtersStore.read(), trackedRefs()]);
    const queries = filters.layers.map((layer) => layerSearchQuery(layer, filters.excludeRepos));
    // Teammates and Team share one search unless their hidden repos differ.
    const unique = [...new Set(queries)];
    const [searched, teammates] = await Promise.all([
      deps.fetchReviewQueue(hostId, unique, tracked),
      readTeammates(hostId, filters.teammatesTeam),
    ]);
    const fetched = {
      ...searched,
      layers: queries.map((query) => searched.layers[unique.indexOf(query)]!),
    };
    await deleteEach(fetched.gone, marks.delete, (ref) => `the reviewed mark of ${refKey(ref)}`);
    const truncated = new Set(
      filters.layers.filter((_, index) => fetched.layers[index]?.truncated).map(({ name }) => name),
    );
    return linkAndForget(
      mergeRows(fetched, filters.layers, teammates.members),
      truncated,
      deps.now(),
      teammates.error,
    );
  }

  async function readTeammates(
    hostId: string,
    team: string | null,
  ): Promise<{ members: Set<string> | null; error: string | null }> {
    if (team === null) return { members: null, error: null };
    try {
      return { members: new Set(await deps.fetchTeamMembers(hostId, team)), error: null };
    } catch (error) {
      deps.warn(`Could not read the members of ${team}: ${errorText(error)}`);
      return { members: null, error: errorText(error) };
    }
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
    if (result.kind === "ok") void autoStart();
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
      const next = await linkAndForget(
        rowsOf(view),
        truncatedLayersOf(view),
        view.loadedAt,
        view.teammatesError,
      );
      // A load that finished meanwhile has newer GitHub data; keep it over this re-link.
      const current = await readStored();
      if (current === null || viewOf(current)?.loadedAt !== view.loadedAt) return;
      await store(current.kind === "ok" ? { kind: "ok", ...next } : { ...current, lastGood: next });
    } catch (error) {
      deps.warn(`Review queue update failed: ${errorText(error)}`);
      return;
    }
    // A stopped or archived thread frees a slot; a shown repo or unmarked PR may queue one.
    void autoStart();
  }

  let autoStarting: Promise<void> = Promise.resolve();

  /**
   * Sends due re-reviews, then starts review threads for queued PRs, oldest first, while fewer
   * than the limit work.
   */
  function autoStart(): Promise<void> {
    autoStarting = autoStarting.then(autoStartOnce);
    return autoStarting;
  }

  async function autoStartOnce(): Promise<void> {
    try {
      const settings = await autoReview.get();
      if (!settings.enabled) return;
      const stored = await readStored();
      const view = stored && viewOf(stored);
      if (view === null) return;
      const byAge = (a: LinkedQueuePr, b: LinkedQueuePr) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt);
      const prs = viewPrs(view);
      const reReviewPrs = prs.filter((pr) => pr.autoReReview).sort(byAge);
      const queuedPrs = prs.filter((pr) => pr.autoQueued).sort(byAge);
      if (reReviewPrs.length === 0 && queuedPrs.length === 0) return;
      const threads = await liveReviewThreads();
      let free = settings.maxRunning - threads.filter(isBusy).length;
      if (free <= 0) return;
      // Re-reviews go first: the author asked again, and the thread already has the context.
      const sent = await autoReReview(reReviewPrs, threads, free);
      free -= sent;
      const spawned =
        free > 0 && queuedPrs.length > 0 ? await autoSpawn(queuedPrs, threads, free) : 0;
      if (sent + spawned > 0) void relink();
    } catch (error) {
      deps.warn(`Auto-review failed: ${errorText(error)}`);
    }
  }

  /** Sends Re-review to up to `free` idle review threads. Returns how many it sent. */
  async function autoReReview(
    prs: LinkedQueuePr[],
    threads: QueueThread[],
    free: number,
  ): Promise<number> {
    if (prs.length === 0) return 0;
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    // A Re-review click may have sent one the stored view does not show yet.
    const lastSent = new Map((await reReviews.list()).map((entry) => [refKey(entry.ref), entry]));
    let sent = 0;
    for (const pr of prs) {
      if (sent >= free) break;
      const key = prKey(pr.repo, pr.number);
      const thread = pr.thread === null ? undefined : byId.get(pr.thread.id);
      if (thread === undefined || threadStatus(thread) !== "idle") continue;
      const requestedAt = Date.parse(pr.activity?.lastRequestedAt ?? "");
      if ((lastSent.get(key)?.sentAt ?? 0) >= requestedAt) continue;
      const result = await sendReReview({
        threadId: thread.id,
        repo: pr.repo,
        number: pr.number,
        headOid: pr.headOid,
      });
      if (result.kind === "error") {
        deps.warn(`Could not auto re-review ${key}: ${result.message}`);
        continue;
      }
      sent += 1;
    }
    return sent;
  }

  /** Starts review threads for up to `free` queued PRs. Returns how many it started. */
  async function autoSpawn(
    queuedPrs: LinkedQueuePr[],
    threads: QueueThread[],
    free: number,
  ): Promise<number> {
    const [started, hostId] = await Promise.all([autoStarted.list(), deps.primaryHostId()]);
    if (hostId === null) return 0;
    // A Start review click may have spawned a thread the stored view does not link yet.
    const [reviews, instructions] = await Promise.all([
      startedReviews(threads),
      deps.reviewInstructions(),
    ]);
    const reviewed = new Set(reviews.map(({ pr }) => prKey(pr.repo, pr.number)));
    let spawned = 0;
    for (const pr of queuedPrs) {
      if (spawned >= free) break;
      const key = prKey(pr.repo, pr.number);
      if (started.has(key) || reviewed.has(key)) continue;
      const { repo, number, title, url } = pr;
      const reviewPr = { repo, number, title, url };
      let threadId: string;
      try {
        threadId = await deps.spawnReviewThread(
          reviewPr,
          autoReviewRequest(pr.projectIds[0]!, hostId, buildReviewPrompt(reviewPr, instructions)),
        );
      } catch (error) {
        deps.warn(`Could not auto-review ${key}: ${errorText(error)}`);
        continue;
      }
      spawned += 1;
      await autoStarted
        .add(key, threadId)
        .catch((error) =>
          deps.warn(`Could not record the auto-review of ${key}: ${errorText(error)}`),
        );
    }
    return spawned;
  }

  async function getAutoReview(): Promise<AutoReviewSettings> {
    return autoReview.get();
  }

  async function setAutoReview(settings: AutoReviewSettings): Promise<ActionResult> {
    try {
      await autoReview.save(settings);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    // The re-link marks the queued PRs and then starts the first ones.
    await relink();
    return { kind: "ok" };
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

  /** A new mark makes an earlier re-review moot. */
  async function forgetReReview(ref: PullRequestRef): Promise<void> {
    try {
      await reReviews.delete(ref);
    } catch (error) {
      deps.warn(`Could not delete the re-review of ${refKey(ref)}: ${errorText(error)}`);
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
    await Promise.all([forgetSeenComments(ref), forgetReReview(ref)]);
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
    await Promise.all([forgetSeenComments(ref), forgetReReview(ref)]);
    await relink();
    return { kind: "ok" };
  }

  /** Sends the re-review prompt to the PR's review thread, comparing with the reviewed mark. */
  async function reReview(request: ReReviewRequest): Promise<ActionResult> {
    const result = await sendReReview(request);
    if (result.kind === "ok") await relink();
    return result;
  }

  async function sendReReview({
    threadId,
    repo,
    number,
    headOid,
  }: ReReviewRequest): Promise<ActionResult> {
    const ref = refOf(repo, number);
    if (ref === null) return { kind: "error", message: INVALID_REPOSITORY_MESSAGE };
    try {
      const pr = readReviewPr(await deps.readPluginMetadata(threadId));
      if (pr === null || prKey(pr.repo, pr.number) !== refKey(ref)) {
        return { kind: "error", message: NOT_A_REVIEW_THREAD_MESSAGE };
      }
      const mark = await marks.get(ref);
      if (mark === null) return { kind: "error", message: NOT_REVIEWED_MESSAGE };
      const prompt = buildReReviewPrompt(
        pr,
        { reviewedOid: mark.headOid, reviewedAt: mark.markedAt },
        await deps.reReviewInstructions(),
      );
      await deps.sendMessage(threadId, prompt);
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    // The prompt went out; a lost record only offers Re-review again.
    await reReviews
      .save(ref, headOid)
      .catch((error) =>
        deps.warn(`Could not record the re-review of ${refKey(ref)}: ${errorText(error)}`),
      );
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
    return viewPrs(view).some((pr) => pr.thread?.id === threadId);
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

  async function setRepoVisibility(
    { repo, layer }: RepoVisibilityRequest,
    hidden: boolean,
  ): Promise<ActionResult> {
    if (refOf(repo, 1) === null) return { kind: "error", message: INVALID_REPOSITORY_MESSAGE };
    try {
      await filtersStore.save(setRepoHidden(await filtersStore.read(), repo, layer, hidden));
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    // Hiding drops the repo's PRs from the stored rows at once. Both change the searches.
    if (hidden) await relink();
    void refreshReviewQueue();
    return { kind: "ok" };
  }

  async function setIgnored(
    { repo, number }: PrRefRequest,
    ignored: boolean,
  ): Promise<ActionResult> {
    if (refOf(repo, number) === null) {
      return { kind: "error", message: INVALID_REPOSITORY_MESSAGE };
    }
    try {
      const key = prKey(repo, number);
      await (ignored ? ignoredPrs.add(key) : ignoredPrs.remove([key]));
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    await relink();
    return { kind: "ok" };
  }

  async function getViewerTeams(): Promise<ViewerTeamsResult> {
    try {
      const hostId = await deps.primaryHostId();
      if (hostId === null) return { kind: "error", message: NO_HOST_MESSAGE };
      return { kind: "ok", teams: await deps.listViewerTeams(hostId) };
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
  }

  async function setTeammatesTeam({ team }: TeammatesTeamRequest): Promise<ActionResult> {
    try {
      await filtersStore.save({ ...(await filtersStore.read()), teammatesTeam: team });
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
    void refreshReviewQueue();
    return { kind: "ok" };
  }

  async function run(signal: AbortSignal): Promise<void> {
    await deps.kv
      .delete(TEAM_PRS_STORAGE_KEY)
      .catch((error) => deps.warn(`Could not delete the team PR scan: ${errorText(error)}`));
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
    reReview,
    markQueueSeen,
    newCommentBasis,
    markCommentsSeen,
    threadActive,
    threadStopped,
    markThreadOpened,
    hideRepo: (request: RepoVisibilityRequest) => setRepoVisibility(request, true),
    showRepo: (request: RepoVisibilityRequest) => setRepoVisibility(request, false),
    ignorePr: (request: PrRefRequest) => setIgnored(request, true),
    unignorePr: (request: PrRefRequest) => setIgnored(request, false),
    getViewerTeams,
    setTeammatesTeam,
    getAutoReview,
    setAutoReview,
    /** Resolves when the auto-review passes started so far are done. For tests. */
    autoReviewSettled: () => autoStarting,
    run,
  };
}
