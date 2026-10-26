import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ActionResult } from "../contract";
import {
  ACTIVITY_LOOKBACK_MS,
  activityItemSchema,
  classifyPr,
  type ActivityPrDetail,
  type PrNotification,
} from "../core/activity";
import {
  loadedActivitySchema,
  type ActivityResult,
  type ActivityView,
  type ActivityViewPr,
  type LoadedActivity,
} from "../core/activity-view";
import type { PullRequestRef } from "../core/pr-ref";

export const ACTIVITY_INTERVAL_MS = 60_000;
export const ACTIVITY_STORAGE_KEY = "activity";
const NO_HOST_MESSAGE = "No host available";

export interface ActivityServiceDeps {
  primaryHostId(): Promise<string | null>;
  fetchNotifications(hostId: string, since: string): Promise<PrNotification[]>;
  fetchDetails(
    hostId: string,
    prs: PullRequestRef[],
  ): Promise<{ viewer: string; prs: (ActivityPrDetail | null)[] }>;
  /** Your teams as `org/slug`, for team mentions. */
  listTeams(hostId: string): Promise<string[]>;
  markNotificationRead(hostId: string, threadId: string): Promise<void>;
  kv: Pick<PluginKvStorage, "get" | "set">;
  publish(result: LoadedActivity): void;
  warn(message: string): void;
  now(): number;
}

const storedPrSchema = z.object({
  repo: z.string(),
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["open", "merged", "closed"]),
  mine: z.boolean(),
  items: z.array(activityItemSchema),
  /** The notification's `updated_at` when the PR was last read. */
  checkedAt: z.string(),
  threadId: z.string(),
  /** The notification is unread on GitHub. */
  unreadOnGithub: z.boolean(),
});
type StoredPr = z.infer<typeof storedPrSchema>;

const storedStateSchema = z.object({
  v: z.literal(1),
  prs: z.record(z.string(), storedPrSchema),
  read: z.array(z.string()),
  /** Lowercase logins whose activity is left out, such as a CI account that is not a bot. */
  muted: z.array(z.string()).default([]),
  result: loadedActivitySchema.nullable(),
});
type StoredState = z.infer<typeof storedStateSchema>;

const EMPTY: StoredState = { v: 1, prs: {}, read: [], muted: [], result: null };

const PR_STATE = { OPEN: "open", MERGED: "merged", CLOSED: "closed" } as const;

function keyOf(repo: string, number: number): string {
  return `${repo.toLowerCase()}#${number}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function viewOf(state: StoredState, loadedAt: number): ActivityView {
  const read = new Set(state.read);
  const muted = new Set(state.muted);
  const prs: ActivityViewPr[] = Object.values(state.prs)
    .map((pr) => ({
      ...pr,
      items: pr.items.filter((item) => !muted.has(item.actor.toLowerCase())),
    }))
    .filter((pr) => pr.items.length > 0)
    .map(({ repo, number, title, url, state: prState, mine, items }) => {
      const viewItems = items.map((item) => ({ ...item, read: read.has(item.id) }));
      return {
        repo,
        number,
        title,
        url,
        state: prState,
        mine,
        items: viewItems,
        unread: viewItems.filter((item) => !item.read).length,
      };
    })
    .sort((a, b) => Date.parse(b.items[0]!.at) - Date.parse(a.items[0]!.at));
  return {
    prs,
    unread: prs.reduce((sum, pr) => sum + pr.unread, 0),
    muted: state.muted,
    loadedAt,
  };
}

export function createActivityService(deps: ActivityServiceDeps) {
  let running: Promise<LoadedActivity> | null = null;
  let writing: Promise<unknown> = Promise.resolve();

  async function readState(): Promise<StoredState> {
    const parsed = storedStateSchema.safeParse(await deps.kv.get(ACTIVITY_STORAGE_KEY));
    return parsed.success ? parsed.data : EMPTY;
  }

  /** Runs state changes one at a time, so a load and a mark do not overwrite each other. */
  function update<T>(change: (state: StoredState) => Promise<{ state: StoredState; value: T }>) {
    const next = writing.then(async () => {
      const { state, value } = await change(await readState());
      await deps.kv.set(ACTIVITY_STORAGE_KEY, state);
      if (state.result !== null) deps.publish(state.result);
      return value;
    });
    writing = next.catch(() => {});
    return next;
  }

  function withView(state: StoredState): StoredState {
    const loadedAt =
      state.result === null
        ? deps.now()
        : state.result.kind === "ok"
          ? state.result.loadedAt
          : (state.result.lastGood?.loadedAt ?? deps.now());
    const view = viewOf(state, loadedAt);
    const result: LoadedActivity =
      state.result?.kind === "error"
        ? { ...state.result, lastGood: view }
        : { kind: "ok", ...view };
    return { ...state, result };
  }

  interface Fetched {
    prs: Record<string, StoredPr>;
    /** Items read on github.com. */
    readOnGithub: string[];
    loadedAt: number;
  }

  /** Reads GitHub. Runs outside `update`, so marking items read does not wait for it. */
  async function fetchChanges(state: StoredState): Promise<Fetched> {
    const hostId = await deps.primaryHostId();
    if (hostId === null) throw new Error(NO_HOST_MESSAGE);
    const now = deps.now();
    const since = now - ACTIVITY_LOOKBACK_MS;
    const notifications = await deps.fetchNotifications(hostId, new Date(since).toISOString());
    const changed = notifications.filter(
      (notification) =>
        state.prs[
          keyOf(`${notification.ref.owner}/${notification.ref.repo}`, notification.ref.number)
        ]?.checkedAt !== notification.updatedAt,
    );
    const [details, teams] =
      changed.length === 0
        ? [null, []]
        : await Promise.all([
            deps.fetchDetails(
              hostId,
              changed.map(({ ref }) => ref),
            ),
            deps.listTeams(hostId).catch((error) => {
              deps.warn(`Could not read your teams for mentions: ${errorText(error)}`);
              return [];
            }),
          ]);
    const prs: Record<string, StoredPr> = {};
    const readOnGithub: string[] = [];
    const listed = new Set<string>();
    for (const notification of notifications) {
      const { ref } = notification;
      const key = keyOf(`${ref.owner}/${ref.repo}`, ref.number);
      listed.add(key);
      const index = changed.indexOf(notification);
      const previous = state.prs[key];
      const detail = index === -1 ? null : (details?.prs[index] ?? null);
      if (detail !== null && details !== null) {
        prs[key] = {
          repo: detail.repository.nameWithOwner,
          number: detail.number,
          title: detail.title,
          url: detail.url,
          state: PR_STATE[detail.state],
          mine: detail.author?.login.toLowerCase() === details.viewer.toLowerCase(),
          items: classifyPr(detail, { me: details.viewer, teams, since }),
          checkedAt: notification.updatedAt,
          threadId: notification.threadId,
          unreadOnGithub: notification.unread,
        };
      } else if (previous !== undefined) {
        prs[key] = {
          ...previous,
          threadId: notification.threadId,
          unreadOnGithub: notification.unread,
        };
      }
      // Reading the notification on github.com reads everything up to that time here.
      const stored = prs[key];
      if (stored !== undefined && !notification.unread && notification.lastReadAt !== null) {
        const readAt = Date.parse(notification.lastReadAt);
        for (const item of stored.items) {
          if (Date.parse(item.at) <= readAt) readOnGithub.push(item.id);
        }
      }
    }
    // Keep PRs that left the notification window while they still have recent items.
    for (const [key, previous] of Object.entries(state.prs)) {
      if (listed.has(key)) continue;
      const items = previous.items.filter((item) => Date.parse(item.at) > since);
      if (items.length > 0) prs[key] = { ...previous, items };
    }
    return { prs, readOnGithub, loadedAt: now };
  }

  /** Applies a load to the current state, keeping items marked read while it ran. */
  function applyLoad(state: StoredState, fetched: Fetched): StoredState {
    const ids = new Set(Object.values(fetched.prs).flatMap((pr) => pr.items.map(({ id }) => id)));
    const read = [...new Set([...state.read, ...fetched.readOnGithub])].filter((id) => ids.has(id));
    // A PR marked read here while the load ran stays read on GitHub too.
    const prs = Object.fromEntries(
      Object.entries(fetched.prs).map(([key, pr]) => [
        key,
        state.prs[key]?.unreadOnGithub === false ? { ...pr, unreadOnGithub: false } : pr,
      ]),
    );
    const view = viewOf({ ...state, prs, read }, fetched.loadedAt);
    return { v: 1, prs, read, muted: state.muted, result: { kind: "ok", ...view } };
  }

  async function runLoad(): Promise<LoadedActivity> {
    let fetched: Fetched | null = null;
    let failure: unknown = null;
    try {
      fetched = await fetchChanges(await readState());
    } catch (error) {
      failure = error;
    }
    return update(async (state) => {
      if (fetched !== null) {
        const next = applyLoad(state, fetched);
        return { state: next, value: next.result! };
      }
      const previous = state.result;
      const lastGood =
        previous === null ? null : previous.kind === "ok" ? previous : previous.lastGood;
      const result: LoadedActivity = {
        kind: "error",
        message: errorText(failure),
        lastGood:
          lastGood === null
            ? null
            : {
                prs: lastGood.prs,
                unread: lastGood.unread,
                muted: lastGood.muted,
                loadedAt: lastGood.loadedAt,
              },
      };
      return { state: { ...state, result }, value: result };
    });
  }

  function refreshActivity(): Promise<LoadedActivity> {
    running ??= runLoad().finally(() => {
      running = null;
    });
    return running;
  }

  async function getActivity(): Promise<ActivityResult> {
    return (await readState()).result ?? { kind: "loading" };
  }

  /** Marks items read. A PR with nothing unread left is marked read on GitHub too. */
  async function markRead(ids: readonly string[]): Promise<ActionResult> {
    try {
      const done = await update(async (state) => {
        const read = new Set([...state.read, ...ids]);
        const finished = Object.values(state.prs).filter(
          (pr) =>
            pr.unreadOnGithub &&
            pr.items.some((item) => ids.includes(item.id)) &&
            pr.items.every((item) => read.has(item.id)),
        );
        const prs = { ...state.prs };
        for (const pr of finished)
          prs[keyOf(pr.repo, pr.number)] = { ...pr, unreadOnGithub: false };
        return { state: withView({ ...state, prs, read: [...read] }), value: finished };
      });
      void markReadOnGithub(done);
      return { kind: "ok" };
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
  }

  async function markReadOnGithub(prs: readonly StoredPr[]): Promise<void> {
    if (prs.length === 0) return;
    const hostId = await deps.primaryHostId().catch(() => null);
    if (hostId === null) return;
    await Promise.all(
      prs.map((pr) =>
        deps
          .markNotificationRead(hostId, pr.threadId)
          .catch((error) =>
            deps.warn(
              `Could not mark ${keyOf(pr.repo, pr.number)} read on GitHub: ${errorText(error)}`,
            ),
          ),
      ),
    );
  }

  async function markPrRead({
    repo,
    number,
  }: {
    repo: string;
    number: number;
  }): Promise<ActionResult> {
    const state = await readState();
    const pr = state.prs[keyOf(repo, number)];
    if (pr === undefined) return { kind: "ok" };
    return markRead(pr.items.map(({ id }) => id));
  }

  async function markAllRead(): Promise<ActionResult> {
    const state = await readState();
    return markRead(Object.values(state.prs).flatMap((pr) => pr.items.map(({ id }) => id)));
  }

  /** Leaves out, or brings back, the activity of one person. */
  async function setMuted(login: string, muted: boolean): Promise<ActionResult> {
    try {
      await update(async (state) => {
        const key = login.toLowerCase();
        const rest = state.muted.filter((entry) => entry !== key);
        return {
          state: withView({ ...state, muted: muted ? [...rest, key] : rest }),
          value: undefined,
        };
      });
      return { kind: "ok" };
    } catch (error) {
      return { kind: "error", message: errorText(error) };
    }
  }

  async function run(signal: AbortSignal): Promise<void> {
    const aborted = new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    while (!signal.aborted) {
      await Promise.race([refreshActivity(), aborted]);
      if (signal.aborted) return;
      await sleep(ACTIVITY_INTERVAL_MS, signal);
    }
  }

  return { getActivity, refreshActivity, markRead, markPrRead, markAllRead, setMuted, run };
}
