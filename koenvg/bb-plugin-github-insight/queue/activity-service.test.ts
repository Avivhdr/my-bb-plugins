import { describe, expect, it } from "vitest";
import type { ActivityPrDetail, PrNotification } from "../core/activity";
import type { LoadedActivity } from "../core/activity-view";
import type { PullRequestRef } from "../core/pr-ref";
import {
  ACTIVITY_STORAGE_KEY,
  createActivityService,
  type ActivityServiceDeps,
} from "./activity-service";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const ref = { owner: "acme", repo: "api", number: 7 };

function notification(overrides: Partial<PrNotification> = {}): PrNotification {
  return {
    threadId: "101",
    ref,
    unread: true,
    updatedAt: "2026-10-22T10:00:00Z",
    lastReadAt: null,
    ...overrides,
  };
}

function detail(comments: { id: string; login: string; at: string; body?: string }[]) {
  return {
    number: 7,
    title: "Add retries",
    url: "https://github.com/acme/api/pull/7",
    state: "OPEN",
    author: { login: "me" },
    repository: { nameWithOwner: "acme/api" },
    comments: {
      nodes: comments.map(({ id, login, at, body }) => ({
        id,
        body: body ?? `Comment ${id}`,
        createdAt: at,
        url: `https://c/${id}`,
        author: { __typename: "User", login },
      })),
    },
    reviews: { nodes: [] },
    reviewThreads: { nodes: [] },
  } as ActivityPrDetail;
}

function fakeKv() {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: async <T>(key: string) => entries.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
  };
}

function serviceWith(overrides: Partial<ActivityServiceDeps> = {}) {
  const published: LoadedActivity[] = [];
  const detailCalls: PullRequestRef[][] = [];
  const markedOnGithub: string[] = [];
  let notifications = [notification()];
  let comments = [
    { id: "C1", login: "bob", at: "2026-10-22T09:00:00Z" },
    { id: "C2", login: "carol", at: "2026-10-22T10:00:00Z" },
  ];
  const kv = fakeKv();
  const service = createActivityService({
    primaryHostId: async () => "host-1",
    fetchNotifications: async () => notifications,
    fetchDetails: async (_hostId, prs) => {
      detailCalls.push(prs);
      return { viewer: "me", prs: prs.map(() => detail(comments)) };
    },
    listTeams: async () => [],
    markNotificationRead: async (_hostId, threadId) => {
      markedOnGithub.push(threadId);
    },
    kv,
    publish: (result) => published.push(result),
    warn: () => {},
    now: () => NOW,
    ...overrides,
  });
  return {
    service,
    kv,
    published,
    detailCalls,
    markedOnGithub,
    setNotifications: (next: PrNotification[]) => (notifications = next),
    setComments: (next: typeof comments) => (comments = next),
  };
}

function okOf(result: LoadedActivity) {
  if (result.kind !== "ok") throw new Error(`expected ok, got ${result.message}`);
  return result;
}

describe("activity service", () => {
  it("reports loading before the first load", async () => {
    expect(await serviceWith().service.getActivity()).toEqual({ kind: "loading" });
  });

  it("lists the comments on a PR in the notifications, newest first, as unread", async () => {
    const { service, published } = serviceWith();

    const view = okOf(await service.refreshActivity());

    expect(view.unread).toBe(2);
    expect(view.prs).toMatchObject([
      { repo: "acme/api", number: 7, title: "Add retries", state: "open", mine: true, unread: 2 },
    ]);
    expect(view.prs[0]!.items.map((item) => [item.id, item.read])).toEqual([
      ["C2", false],
      ["C1", false],
    ]);
    expect(published).toHaveLength(1);
    expect(await service.getActivity()).toEqual(published[0]);
  });

  it("reads a PR again only when its notification changed", async () => {
    const { service, detailCalls, setNotifications } = serviceWith();
    await service.refreshActivity();
    await service.refreshActivity();
    expect(detailCalls).toHaveLength(1);

    setNotifications([notification({ updatedAt: "2026-10-22T11:00:00Z" })]);
    await service.refreshActivity();

    expect(detailCalls).toEqual([[ref], [ref]]);
  });

  it("marks items read and keeps them read after the next load", async () => {
    const { service, setNotifications } = serviceWith();
    await service.refreshActivity();

    expect(await service.markRead(["C1"])).toEqual({ kind: "ok" });
    setNotifications([notification({ updatedAt: "2026-10-22T11:00:00Z" })]);
    const view = okOf(await service.refreshActivity());

    expect(view.unread).toBe(1);
    expect(view.prs[0]!.items.find((item) => item.id === "C1")?.read).toBe(true);
  });

  it("marks the GitHub notification read once nothing on the PR is unread", async () => {
    const { service, markedOnGithub } = serviceWith();
    await service.refreshActivity();

    await service.markRead(["C1"]);
    expect(markedOnGithub).toEqual([]);
    await service.markPrRead({ repo: "acme/api", number: 7 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(markedOnGithub).toEqual(["101"]);
    expect(okOf((await service.getActivity()) as LoadedActivity).unread).toBe(0);
  });

  it("reads what you read on github.com, up to the time you read it", async () => {
    const { service, setNotifications } = serviceWith();
    await service.refreshActivity();

    setNotifications([
      notification({
        unread: false,
        lastReadAt: "2026-10-22T09:30:00Z",
        updatedAt: "2026-10-22T10:00:00Z",
      }),
    ]);
    const view = okOf(await service.refreshActivity());

    expect(view.prs[0]!.items.map((item) => [item.id, item.read])).toEqual([
      ["C2", false],
      ["C1", true],
    ]);
  });

  it("leaves out a muted person and brings them back", async () => {
    const { service } = serviceWith();
    await service.refreshActivity();

    await service.setMuted("Bob", true);
    let view = okOf((await service.getActivity()) as LoadedActivity);
    expect(view.prs[0]!.items.map((item) => item.actor)).toEqual(["carol"]);
    expect(view.muted).toEqual(["bob"]);

    await service.setMuted("bob", false);
    view = okOf((await service.getActivity()) as LoadedActivity);
    expect(view.prs[0]!.items).toHaveLength(2);
  });

  it("keeps the last good feed with the error when a load fails", async () => {
    let fail = false;
    const { service } = serviceWith({
      fetchNotifications: async () => {
        if (fail) throw new Error("gh not logged in");
        return [notification()];
      },
    });
    await service.refreshActivity();
    fail = true;

    const result = await service.refreshActivity();

    expect(result).toMatchObject({ kind: "error", message: "gh not logged in" });
    if (result.kind === "error") expect(result.lastGood?.unread).toBe(2);
  });

  it("drops a PR with no items, and items that left the window", async () => {
    const { service, setComments, setNotifications, kv } = serviceWith();
    setComments([{ id: "C0", login: "bob", at: "2026-10-01T09:00:00Z" }]);

    const view = okOf(await service.refreshActivity());
    expect(view.prs).toEqual([]);

    setNotifications([]);
    await service.refreshActivity();
    expect((kv.entries.get(ACTIVITY_STORAGE_KEY) as { prs: object }).prs).toEqual({});
  });

  it("reports no host available without a primary host", async () => {
    const { service } = serviceWith({ primaryHostId: async () => null });

    expect(await service.refreshActivity()).toMatchObject({
      kind: "error",
      message: "No host available",
    });
  });
});
