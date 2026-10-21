import { describe, expect, it } from "vitest";
import recordedThreads from "../test/fixtures/pr-25259-review-threads.json";
import { collectReviewThreads, MAX_THREAD_PAGES, parseReviewThreads } from "./review-threads";

function threadsPage(
  nodes: unknown[],
  pageInfo: { hasNextPage: boolean; endCursor: string | null } = {
    hasNextPage: false,
    endCursor: null,
  },
) {
  return { data: { repository: { pullRequest: { reviewThreads: { pageInfo, nodes } } } } };
}

function threadNode(id: string) {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    path: "src/a.ts",
    line: 1,
    originalLine: 1,
    diffSide: "RIGHT",
    comments: { totalCount: 0, nodes: [] },
  };
}

function byId(id: string) {
  return parseReviewThreads([recordedThreads]).find((thread) => thread.id === id)!;
}

describe("parseReviewThreads", () => {
  it("reads an open thread with its line and side", () => {
    expect(byId("PRRT_kwDOHI7l-86jxula")).toMatchObject({
      resolved: false,
      outdated: false,
      path: "apps/shell/e2e/catalog/integrations/components/asset/generic-configuration/createDatabricksOutboundSyncConfigurationComponent.ts",
      line: 46,
      originalLine: 44,
      side: "RIGHT",
    });
  });

  it("reads a resolved thread", () => {
    expect(byId("PRRT_kwDOHI7l-86jvKxS")).toMatchObject({ resolved: true });
  });

  it("reads an outdated thread without a line", () => {
    expect(byId("PRRT_kwDOHI7l-86jx0SN")).toMatchObject({
      outdated: true,
      line: null,
      originalLine: 32,
    });
  });

  it("reads all comments of a thread with replies, in order", () => {
    const thread = byId("PRRT_kwDOHI7l-86jx0SN");

    expect(thread.comments.map(({ author, createdAt }) => [author, createdAt])).toEqual([
      ["a-bandziuk", "2026-09-18T14:39:06Z"],
      ["RuslanPleskunCollibra", "2026-09-18T15:18:00Z"],
    ]);
    expect(thread.comments[0]).toMatchObject({
      body: expect.stringContaining("actionTimeout"),
      url: expect.stringContaining("#discussion_r"),
      diffHunk: expect.stringMatching(/^@@ -10,22 \+14,31 @@/),
    });
  });

  it("names a deleted account ghost, as GitHub does", () => {
    const node = threadNode("t1");
    node.comments.nodes = [
      {
        id: "c1",
        author: null,
        body: "hi",
        bodyHTML: "<p>hi</p>",
        createdAt: "2026-09-18T14:39:06Z",
        url: "https://github.com/o/r/pull/1#discussion_r1",
        diffHunk: "@@ -1 +1 @@",
      },
    ] as never[];
    node.comments.totalCount = 1;

    expect(parseReviewThreads([threadsPage([node])])[0]!.comments[0]!.author).toBe("ghost");
  });

  it("tells when GitHub has more comments than the page holds", () => {
    const node = threadNode("t1");
    node.comments.totalCount = 101;

    expect(parseReviewThreads([threadsPage([node])])[0]!.hasMoreComments).toBe(true);
    expect(byId("PRRT_kwDOHI7l-86jx0SN").hasMoreComments).toBe(false);
  });
});

describe("collectReviewThreads", () => {
  it("follows the cursor and joins all pages", async () => {
    const asked: (string | null)[] = [];
    const { threads, complete } = await collectReviewThreads(async (after) => {
      asked.push(after);
      return after === null
        ? threadsPage([threadNode("t1")], { hasNextPage: true, endCursor: "c1" })
        : threadsPage([threadNode("t2")]);
    });

    expect(asked).toEqual([null, "c1"]);
    expect(threads.map((thread) => thread.id)).toEqual(["t1", "t2"]);
    expect(complete).toBe(true);
  });

  it(`stops after ${MAX_THREAD_PAGES} pages and says the list is not complete`, async () => {
    let calls = 0;
    const { complete } = await collectReviewThreads(async () => {
      calls++;
      return threadsPage([threadNode(`t${calls}`)], { hasNextPage: true, endCursor: "next" });
    });

    expect(calls).toBe(MAX_THREAD_PAGES);
    expect(complete).toBe(false);
  });

  it("lists the comments of other people with their publish time", async () => {
    const node = threadNode("t1");
    const comment = (id: string, author: unknown, publishedAt: string | null) => ({
      id,
      author,
      body: "hi",
      bodyHTML: "<p>hi</p>",
      createdAt: "2026-10-01T09:00:00Z",
      publishedAt,
      url: `https://github.com/o/r/pull/1#discussion_${id}`,
      diffHunk: "@@ -1 +1 @@",
    });
    node.comments.nodes = [
      comment("c1", { __typename: "User", login: "alice" }, "2026-10-01T11:00:00Z"),
      comment("c2", { __typename: "User", login: "me" }, null),
      comment("c3", { __typename: "Bot", login: "renovate" }, null),
      comment("c4", null, null),
    ] as never[];
    const page = { data: { viewer: { login: "me" }, ...threadsPage([node]).data } };

    const { othersComments } = await collectReviewThreads(async () => page);

    expect(othersComments).toEqual([{ id: "c1", postedAt: "2026-10-01T11:00:00Z" }]);
  });

  it("lists no comments of other people without a viewer", async () => {
    expect((await collectReviewThreads(async () => recordedThreads)).othersComments).toEqual([]);
  });
});
