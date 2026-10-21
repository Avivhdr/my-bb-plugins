import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import type { Draft } from "../core/drafts";
import type { CommentDraft, SummaryDraft } from "../core/review-drafts";
import type { ReviewThread } from "../core/review-threads";
import { createDraftStore } from "./draft-store";

function fakeKv(rows: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(rows));
  const kv: PluginKvStorage = {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
    list: async (prefix = "") => [...data.keys()].filter((key) => key.startsWith(prefix)),
  };
  return { kv, data };
}

function thread(id: string, resolved = false): ReviewThread {
  return {
    id,
    resolved,
    outdated: false,
    path: "a.ts",
    line: 1,
    originalLine: 1,
    side: "RIGHT",
    comments: [],
    hasMoreComments: false,
  };
}

function allThreads(...threads: ReviewThread[]) {
  return { threads, othersComments: [], bodyHtml: new Map(), complete: true };
}

const pr = { owner: "collibra", repo: "frontend", number: 25259 };
const otherPr = { owner: "collibra", repo: "frontend", number: 1 };
const draft: Draft = { body: "Renamed in abc123", updatedAt: 1, source: "agent" };

describe("draft store", () => {
  it("keys a draft by PR and review thread", async () => {
    const { kv, data } = fakeKv();

    await createDraftStore(kv).save(pr, "PRRT_a", draft);

    expect(Object.fromEntries(data)).toEqual({ "draft:collibra/frontend#25259:PRRT_a": draft });
  });

  it("replaces the old draft of the same thread", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);

    await store.save(pr, "PRRT_a", draft);
    await store.save(pr, "PRRT_a", { ...draft, body: "Second", updatedAt: 2 });

    expect(await store.liveDrafts(pr, allThreads(thread("PRRT_a")))).toEqual({
      PRRT_a: { ...draft, body: "Second", updatedAt: 2 },
    });
  });

  it("returns only the drafts of the given PR", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.save(pr, "PRRT_a", draft);
    await store.save(otherPr, "PRRT_b", draft);

    expect(await store.liveDrafts(pr, allThreads(thread("PRRT_a"), thread("PRRT_b")))).toEqual({
      PRRT_a: draft,
    });
  });

  it("deletes the drafts of resolved and missing threads", async () => {
    const { kv, data } = fakeKv();
    const store = createDraftStore(kv);
    await store.save(pr, "PRRT_open", draft);
    await store.save(pr, "PRRT_resolved", draft);
    await store.save(pr, "PRRT_gone", draft);

    const drafts = await store.liveDrafts(
      pr,
      allThreads(thread("PRRT_open"), thread("PRRT_resolved", true)),
    );

    expect(drafts).toEqual({ PRRT_open: draft });
    expect([...data.keys()]).toEqual(["draft:collibra/frontend#25259:PRRT_open"]);
  });

  it("keeps the draft of a thread past the read pages, without returning it", async () => {
    const { kv, data } = fakeKv();
    const store = createDraftStore(kv);
    await store.save(pr, "PRRT_resolved", draft);
    await store.save(pr, "PRRT_unread", draft);

    const drafts = await store.liveDrafts(pr, {
      threads: [thread("PRRT_resolved", true)],
      othersComments: [],
      bodyHtml: new Map(),
      complete: false,
    });

    expect(drafts).toEqual({});
    expect([...data.keys()]).toEqual(["draft:collibra/frontend#25259:PRRT_unread"]);
  });

  it("does not match a PR whose number starts with the same digits", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.save({ ...pr, number: 252590 }, "PRRT_a", draft);

    expect(await store.liveDrafts(pr, allThreads(thread("PRRT_a")))).toEqual({});
  });

  it("reads the drafts of open threads without deleting the others", async () => {
    const { kv, data } = fakeKv();
    const store = createDraftStore(kv);
    await store.save(pr, "PRRT_open", draft);
    await store.save(pr, "PRRT_resolved", draft);
    await store.save(pr, "PRRT_gone", draft);

    const drafts = await store.knownDrafts(
      pr,
      allThreads(thread("PRRT_open"), thread("PRRT_resolved", true)),
    );

    expect(drafts).toEqual({ PRRT_open: draft });
    expect(data.size).toBe(3);
  });

  it("deletes a row that is not a draft", async () => {
    const { kv, data } = fakeKv({ "draft:collibra/frontend#25259:PRRT_a": { body: 3 } });

    expect(await createDraftStore(kv).liveDrafts(pr, allThreads(thread("PRRT_a")))).toEqual({});
    expect(data.size).toBe(0);
  });
});

const comment: CommentDraft = {
  path: "src/a.ts",
  side: "RIGHT",
  line: 42,
  startLine: null,
  body: "Null check missing",
  commitOid: "abc123",
  updatedAt: 1,
  source: "agent",
};
const summary: SummaryDraft = { body: "Two issues", updatedAt: 1, source: "agent" };

describe("comment drafts", () => {
  it("keys a comment draft by PR and draft id, as a version 1 entry", async () => {
    const { kv, data } = fakeKv();

    await createDraftStore(kv).saveComment(pr, "d1", comment);

    expect(Object.fromEntries(data)).toEqual({
      "comment:collibra/frontend#25259:d1": { v: 1, ...comment },
    });
  });

  it("lists the comment drafts of the PR with their ids, by path and line", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.saveComment(pr, "d2", { ...comment, line: 50 });
    await store.saveComment(pr, "d3", { ...comment, path: "src/0.ts" });
    await store.saveComment(pr, "d1", comment);
    await store.saveComment(otherPr, "d4", comment);

    expect(await store.comments(pr)).toEqual([
      { id: "d3", ...comment, path: "src/0.ts" },
      { id: "d1", ...comment },
      { id: "d2", ...comment, line: 50 },
    ]);
  });

  it("replaces the comment draft of the same id", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.saveComment(pr, "d1", comment);

    await store.saveComment(pr, "d1", { ...comment, body: "Edited", source: "user" });

    expect(await store.comments(pr)).toEqual([
      { id: "d1", ...comment, body: "Edited", source: "user" },
    ]);
  });

  it("reads one comment draft by id, or null when it is gone", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.saveComment(pr, "d1", comment);

    expect(await store.comment(pr, "d1")).toEqual(comment);
    expect(await store.comment(pr, "d2")).toBeNull();
  });

  it("deletes one comment draft", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.saveComment(pr, "d1", comment);
    await store.saveComment(pr, "d2", comment);

    await store.deleteComment(pr, "d1");

    expect((await store.comments(pr)).map(({ id }) => id)).toEqual(["d2"]);
  });

  it("does not list a malformed entry or an entry of another version", async () => {
    const { kv } = fakeKv({
      "comment:collibra/frontend#25259:bad": { v: 1, body: 3 },
      "comment:collibra/frontend#25259:v2": { ...comment, v: 2 },
    });

    expect(await createDraftStore(kv).comments(pr)).toEqual([]);
  });

  it("does not match a PR whose number starts with the same digits", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.saveComment({ ...pr, number: 252590 }, "d1", comment);

    expect(await store.comments(pr)).toEqual([]);
  });
});

describe("summary draft", () => {
  it("keys the summary by PR, as a version 1 entry", async () => {
    const { kv, data } = fakeKv();

    await createDraftStore(kv).saveSummary(pr, summary);

    expect(Object.fromEntries(data)).toEqual({
      "summary:collibra/frontend#25259": { v: 1, ...summary },
    });
  });

  it("keeps only the last summary", async () => {
    const { kv } = fakeKv();
    const store = createDraftStore(kv);
    await store.saveSummary(pr, summary);

    await store.saveSummary(pr, { ...summary, body: "Second" });

    expect(await store.summary(pr)).toEqual({ ...summary, body: "Second" });
  });

  it("reads no summary for another PR, or for a malformed entry", async () => {
    const { kv } = fakeKv({ "summary:collibra/frontend#25259": { v: 2, ...summary } });
    const store = createDraftStore(kv);

    expect(await store.summary(pr)).toBeNull();
    expect(await store.summary(otherPr)).toBeNull();
  });
});

describe("deleting the review drafts of a PR", () => {
  it("deletes the comment drafts and the summary of that PR only", async () => {
    const { kv, data } = fakeKv({ "comment:collibra/frontend#25259:bad": "not a draft" });
    const store = createDraftStore(kv);
    await store.saveComment(pr, "d1", comment);
    await store.saveSummary(pr, summary);
    await store.save(pr, "PRRT_a", draft);
    await store.saveComment(otherPr, "d2", comment);
    await store.saveSummary(otherPr, summary);

    await store.deleteReviewDrafts(pr);

    expect([...data.keys()].sort()).toEqual([
      "comment:collibra/frontend#1:d2",
      "draft:collibra/frontend#25259:PRRT_a",
      "summary:collibra/frontend#1",
    ]);
  });
});
