import { afterEach, describe, expect, it, vi } from "vitest";
import prFiles from "../test/fixtures/pr-25259-files.json";
import reviewThreads from "../test/fixtures/pr-25259-review-threads.json";
import type { ReviewResult } from "../contract";
import plugin from "../server";
import {
  failed,
  linkedPr,
  ok,
  prHeadResponse,
  setup,
  type HostCall,
  type PullRequestResult,
} from "../test/plugin-harness";

afterEach(() => {
  vi.useRealTimers();
});

describe("review CLI", () => {
  const OPEN = "PRRT_kwDOHI7l-86jxula";
  const RESOLVED = "PRRT_kwDOHI7l-86jvKxS";
  const READ_METHODS = ["fetchPrFiles", "fetchPrHead", "fetchReviewThreads", "readTextFile"];

  function threadsWithResolved(threadId: string) {
    const pullRequest = reviewThreads.data.repository.pullRequest;
    return {
      data: {
        repository: {
          pullRequest: {
            ...pullRequest,
            reviewThreads: {
              ...pullRequest.reviewThreads,
              nodes: pullRequest.reviewThreads.nodes.map((node) =>
                node.id === threadId ? { ...node, isResolved: true } : node,
              ),
            },
          },
        },
      },
    };
  }

  function reviewHost(
    options: {
      threads?: () => unknown;
      file?: unknown;
      headOid?: () => string;
      state?: "OPEN" | "CLOSED" | "MERGED";
    } = {},
  ) {
    return ({ method }: HostCall) => {
      if (method === "fetchPrFiles") return ok(prFiles[0]);
      if (method === "fetchReviewThreads") return ok(options.threads?.() ?? reviewThreads);
      if (method === "fetchPrHead")
        return ok(prHeadResponse({ oid: options.headOid?.(), state: options.state }));
      if (method === "readTextFile") return options.file ?? { ok: true, text: "From file" };
      throw new Error(`unexpected host call ${method}`);
    };
  }

  function setupWithPr(host = reviewHost()) {
    return setup({
      threads: [{ id: "thr_1", environmentId: "env_1" }],
      pullRequests: { env_1: linkedPr(25259) },
      host,
    });
  }

  async function draftsOf(harness: Pick<Awaited<ReturnType<typeof setup>>, "behavior">) {
    const result = (await harness.behavior.callRpc("getReview", {
      threadId: "thr_1",
    })) as ReviewResult;
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    return result.drafts;
  }

  async function commentDraftsOf(harness: Awaited<ReturnType<typeof setup>>) {
    const result = (await harness.behavior.callRpc("getReview", {
      threadId: "thr_1",
    })) as ReviewResult;
    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    return result.commentDrafts;
  }

  it("lists the review commands in help", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(["review", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("draft");
    expect(result.stdout).toContain("comment");
    expect(result.stdout).toContain("summary");
  });

  it.each([
    ["review", "list"],
    ["review", "draft", OPEN, "--body", "Done"],
  ])("fails outside a bb thread: %s %s", async (...argv) => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(argv, {});

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Not running in a bb thread");
    expect(harness.experimental_hostRpcCalls).toHaveLength(0);
  });

  it.each([
    ["review", "list"],
    ["review", "draft", OPEN, "--body", "Done"],
  ])("fails for a thread without a PR: %s %s", async (...argv) => {
    const harness = await setup({ threads: [{ id: "thr_1", environmentId: "env_1" }] });

    const result = await harness.behavior.runCli(argv, { threadId: "thr_1" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No pull request for this thread");
  });

  it("finds the PR right after the thread's branch gets one", async () => {
    const pullRequests: Record<string, PullRequestResult> = {};
    const harness = await setup({
      threads: [{ id: "thr_1", environmentId: "env_1" }],
      pullRequests,
      host: reviewHost(),
    });
    await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });
    pullRequests.env_1 = linkedPr(25259);

    const result = await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });

    expect(result.exitCode).toBe(0);
  });

  it("drafts on the PR right after the thread's branch gets one", async () => {
    const pullRequests: Record<string, PullRequestResult> = {};
    const harness = await setup({
      threads: [{ id: "thr_1", environmentId: "env_1" }],
      pullRequests,
      host: reviewHost(),
    });
    await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });
    pullRequests.env_1 = linkedPr(25259);

    const result = await harness.behavior.runCli(["review", "draft", OPEN, "--body", "Done"], {
      threadId: "thr_1",
    });

    expect(result.exitCode).toBe(0);
  });

  it("names the gh failure", async () => {
    const harness = await setupWithPr(() => failed({ kind: "gh_logged_out" }));

    const result = await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("gh not logged in");
  });

  it("lists the unresolved threads as JSON", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(["review", "list", "--json"], {
      threadId: "thr_1",
    });

    expect(result.exitCode).toBe(0);
    const { threads } = JSON.parse(result.stdout) as {
      threads: { id: string; outdated: boolean }[];
    };
    expect(threads.map(({ id, outdated }) => [id, outdated])).toEqual([
      ["PRRT_kwDOHI7l-86jxqt3", false],
      [OPEN, false],
      ["PRRT_kwDOHI7l-86jx0SN", true],
    ]);
  });

  it("lists the unresolved threads as text", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      `${OPEN}  apps/shell/e2e/catalog/integrations/components/asset/generic-configuration/createDatabricksOutboundSyncConfigurationComponent.ts:46`,
    );
    expect(result.stdout).not.toContain(RESOLVED);
  });

  it("saves a draft, tells the open tab, and flags it in the list", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T10:00:00Z") });
    const harness = await setupWithPr();

    const saved = await harness.behavior.runCli(
      ["review", "draft", OPEN, "--body", "Renamed in abc123"],
      {
        threadId: "thr_1",
      },
    );

    expect(saved).toMatchObject({ exitCode: 0, stdout: `Saved draft for ${OPEN}\n` });
    expect(harness.realtimeSignals).toEqual([
      { channel: "review.drafts-updated", payload: { threadId: "thr_1" } },
    ]);
    expect(await draftsOf(harness)).toEqual({
      [OPEN]: {
        body: "Renamed in abc123",
        updatedAt: Date.parse("2026-09-24T10:00:00Z"),
        source: "agent",
      },
    });
    const listed = await harness.behavior.runCli(["review", "list", "--json"], {
      threadId: "thr_1",
    });
    const { threads } = JSON.parse(listed.stdout) as {
      threads: { id: string; hasDraft: boolean }[];
    };
    expect(threads.filter((thread) => thread.hasDraft).map((thread) => thread.id)).toEqual([OPEN]);
  });

  it("replaces the old draft of the same thread", async () => {
    const harness = await setupWithPr();

    await harness.behavior.runCli(["review", "draft", OPEN, "--body", "First"], {
      threadId: "thr_1",
    });
    await harness.behavior.runCli(["review", "draft", OPEN, "--body", "Second"], {
      threadId: "thr_1",
    });

    expect(await draftsOf(harness)).toEqual({
      [OPEN]: expect.objectContaining({ body: "Second" }),
    });
  });

  it("reads --body-file on the thread's host, relative to the working directory", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(
      ["review", "draft", OPEN, "--body-file", "reply.md"],
      {
        threadId: "thr_1",
        cwd: "/work/repo",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(harness.experimental_hostRpcCalls).toContainEqual(
      expect.objectContaining({
        method: "readTextFile",
        hostId: "host-1",
        input: { path: "reply.md", cwd: "/work/repo" },
      }),
    );
    expect(await draftsOf(harness)).toEqual({
      [OPEN]: expect.objectContaining({ body: "From file" }),
    });
  });

  it("names the file error and saves nothing", async () => {
    const harness = await setupWithPr(
      reviewHost({ file: { ok: false, message: "File not found: reply.md" } }),
    );

    const result = await harness.behavior.runCli(
      ["review", "draft", OPEN, "--body-file", "reply.md"],
      {
        threadId: "thr_1",
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("File not found: reply.md");
    expect(await draftsOf(harness)).toEqual({});
  });

  it.each([[["--body", "a", "--body-file", "b.md"]], [[]]])(
    "needs exactly one of --body and --body-file: %j",
    async (bodyArgs) => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(["review", "draft", OPEN, ...bodyArgs], {
        threadId: "thr_1",
      });

      expect(result.exitCode).not.toBe(0);
      expect(harness.experimental_hostRpcCalls).toHaveLength(0);
    },
  );

  it("refuses an empty draft", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(["review", "draft", OPEN, "--body", "  \n"], {
      threadId: "thr_1",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Draft is empty");
    expect(await draftsOf(harness)).toEqual({});
  });

  it("names an unknown thread id and saves nothing", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(
      ["review", "draft", "PRRT_typo", "--body", "Done"],
      {
        threadId: "thr_1",
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown review thread: PRRT_typo");
    expect(harness.realtimeSignals).toHaveLength(0);
  });

  it("refuses a resolved thread", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.runCli(["review", "draft", RESOLVED, "--body", "Done"], {
      threadId: "thr_1",
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(`Review thread ${RESOLVED} is resolved`);
  });

  it("calls only the GitHub read handlers and readTextFile, never a GitHub write", async () => {
    const harness = await setupWithPr();

    await harness.behavior.runCli(["review", "list", "--json"], { threadId: "thr_1" });
    await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });
    await harness.behavior.runCli(["review", "draft", OPEN, "--body", "Done"], {
      threadId: "thr_1",
    });
    await harness.behavior.runCli(["review", "draft", OPEN, "--body-file", "reply.md"], {
      threadId: "thr_1",
    });
    await harness.behavior.runCli(
      [
        "review",
        "comment",
        "apps/shell/e2e/utils/elements/createTreeGrid.ts",
        "--line",
        "3",
        "--body",
        "Hm",
      ],
      { threadId: "thr_1" },
    );
    await harness.behavior.runCli(["review", "summary", "--body-file", "summary.md"], {
      threadId: "thr_1",
    });

    const methods = new Set(harness.experimental_hostRpcCalls.map((call) => call.method));
    expect([...methods].sort()).toEqual(READ_METHODS);
  });

  it("hides the draft of a thread that got resolved", async () => {
    let threads: unknown = reviewThreads;
    const harness = await setupWithPr(reviewHost({ threads: () => threads }));
    await harness.behavior.runCli(["review", "draft", OPEN, "--body", "Done"], {
      threadId: "thr_1",
    });

    threads = threadsWithResolved(OPEN);

    expect(await draftsOf(harness)).toEqual({});
  });

  it("does not bring back the draft of a resolved thread when it is reopened", async () => {
    let threads: unknown = reviewThreads;
    const harness = await setupWithPr(reviewHost({ threads: () => threads }));
    await harness.behavior.runCli(["review", "draft", OPEN, "--body", "Done"], {
      threadId: "thr_1",
    });
    threads = threadsWithResolved(OPEN);
    await draftsOf(harness);

    threads = reviewThreads;

    expect(await draftsOf(harness)).toEqual({});
  });

  it("says that not all threads were read when an unknown id may be on a later page", async () => {
    const page = reviewThreads.data.repository.pullRequest;
    const endless = {
      data: {
        repository: {
          pullRequest: {
            ...page,
            reviewThreads: {
              ...page.reviewThreads,
              pageInfo: { hasNextPage: true, endCursor: "next" },
            },
          },
        },
      },
    };
    const harness = await setupWithPr(reviewHost({ threads: () => endless }));

    const result = await harness.behavior.runCli(
      ["review", "draft", "PRRT_later", "--body", "Done"],
      {
        threadId: "thr_1",
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown review thread: PRRT_later");
    expect(result.stderr).toContain("Only the first 5 pages of review threads were read.");
  });

  it("keeps a draft across a plugin reload", async () => {
    const harness = await setupWithPr();
    await harness.behavior.runCli(["review", "draft", OPEN, "--body", "Done"], {
      threadId: "thr_1",
    });

    const reloaded = await harness.reload(plugin);

    expect(await draftsOf(reloaded.harness)).toEqual({
      [OPEN]: expect.objectContaining({ body: "Done" }),
    });
  });

  describe("review comment", () => {
    const FILE = "apps/shell/e2e/utils/elements/createTreeGrid.ts";

    function comment(...args: string[]) {
      return ["review", "comment", FILE, ...args];
    }

    it("saves a comment draft at the head commit, prints its id, and tells the open tab", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T10:00:00Z") });
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        comment("--line", "3", "--body", "Null check missing"),
        {
          threadId: "thr_1",
        },
      );

      expect(result.exitCode).toBe(0);
      const [draft] = await commentDraftsOf(harness);
      expect(result.stdout).toBe(`Saved comment draft ${draft!.id}\n`);
      expect(draft).toEqual({
        id: expect.stringMatching(/^[a-z0-9]{8}$/),
        path: FILE,
        side: "RIGHT",
        line: 3,
        startLine: null,
        body: "Null check missing",
        commitOid: "def456",
        updatedAt: Date.parse("2026-09-24T10:00:00Z"),
        source: "agent",
      });
      expect(harness.realtimeSignals).toEqual([
        { channel: "review.drafts-updated", payload: { threadId: "thr_1" } },
      ]);
    });

    it.each(["CLOSED", "MERGED"] as const)(
      "allows an agent's local comment on a %s PR without a GitHub write",
      async (state) => {
        const harness = await setupWithPr(reviewHost({ state }));

        const result = await harness.behavior.runCli(
          comment("--line", "3", "--body", "Keep locally"),
          {
            threadId: "thr_1",
          },
        );

        expect(result.exitCode).toBe(0);
        expect(await commentDraftsOf(harness)).toEqual([
          expect.objectContaining({ body: "Keep locally", commitOid: "def456", source: "agent" }),
        ]);
        expect(harness.experimental_hostRpcCalls.map(({ method }) => method)).toEqual([
          "fetchPrHead",
          "fetchReviewThreads",
          "fetchPrFiles",
          "fetchPrHead",
          "fetchReviewThreads",
          "fetchPrFiles",
        ]);
      },
    );

    it.each([
      [
        "300",
        `Line 300 is not in the diff of ${FILE} on the RIGHT side. Diff ranges: 1-5, 146-154`,
      ],
      ["3", "1 comment draft is at commit abc123, but the PR head is def456"],
    ])(
      "checks line %s before reading the body file, and keeps older drafts",
      async (line, message) => {
        let headOid = "abc123";
        const harness = await setupWithPr(reviewHost({ headOid: () => headOid }));
        const saved = await harness.behavior.runCli(comment("--line", "3", "--body", "Keep"), {
          threadId: "thr_1",
        });
        expect(saved.exitCode).toBe(0);
        const before = await commentDraftsOf(harness);
        headOid = "def456";

        const result = await harness.behavior.runCli(
          comment("--line", line, "--body-file", "notes.md"),
          {
            threadId: "thr_1",
          },
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(message);
        expect(await commentDraftsOf(harness)).toEqual(before);
        expect(
          harness.experimental_hostRpcCalls.filter(({ method }) => method === "readTextFile"),
        ).toEqual([]);
        expect(harness.realtimeSignals).toEqual([
          { channel: "review.drafts-updated", payload: { threadId: "thr_1" } },
        ]);
      },
    );

    it("saves a range on the old side", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        comment("--side", "LEFT", "--start-line", "146", "--line", "148", "--body", "Why?"),
        { threadId: "thr_1" },
      );

      expect(result.exitCode).toBe(0);
      expect(await commentDraftsOf(harness)).toEqual([
        expect.objectContaining({ side: "LEFT", startLine: 146, line: 148 }),
      ]);
    });

    it("reads --body-file relative to the working directory", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        comment("--line", "3", "--body-file", "notes.md"),
        {
          threadId: "thr_1",
          cwd: "/work/repo",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(harness.experimental_hostRpcCalls).toContainEqual(
        expect.objectContaining({
          method: "readTextFile",
          input: { path: "notes.md", cwd: "/work/repo" },
        }),
      );
      expect(await commentDraftsOf(harness)).toEqual([
        expect.objectContaining({ body: "From file" }),
      ]);
    });

    it("names the diff ranges for a line outside the diff and saves nothing", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(comment("--line", "300", "--body", "Hm"), {
        threadId: "thr_1",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        `Line 300 is not in the diff of ${FILE} on the RIGHT side. Diff ranges: 1-5, 146-154`,
      );
      expect(await commentDraftsOf(harness)).toEqual([]);
      expect(harness.realtimeSignals).toHaveLength(0);
    });

    it("refuses a file that the PR does not change", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        ["review", "comment", "src/missing.ts", "--line", "3", "--body", "Hm"],
        { threadId: "thr_1" },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Not a file of this pull request: src/missing.ts");
      expect(await commentDraftsOf(harness)).toEqual([]);
    });

    it("refuses a start line after the line", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        comment("--start-line", "4", "--line", "3", "--body", "Hm"),
        {
          threadId: "thr_1",
        },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Start line 4 is after line 3");
    });

    it("refuses an empty body", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(comment("--line", "3", "--body", "  \n"), {
        threadId: "thr_1",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Comment is empty");
      expect(await commentDraftsOf(harness)).toEqual([]);
    });

    it("refuses a new draft when the drafts are at another commit, and names both commits", async () => {
      let headOid = "abc123";
      const harness = await setupWithPr(reviewHost({ headOid: () => headOid }));
      await harness.behavior.runCli(comment("--line", "3", "--body", "One"), { threadId: "thr_1" });
      await harness.behavior.runCli(comment("--line", "4", "--body", "Two"), { threadId: "thr_1" });
      headOid = "def456";

      const result = await harness.behavior.runCli(comment("--line", "5", "--body", "Three"), {
        threadId: "thr_1",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(
        "2 comment drafts are at commit abc123, but the PR head is def456",
      );
      expect(result.stderr).toContain("Submit or delete those drafts first");
      expect(result.stderr).toContain("bb github-insight review comment delete <draft-id>");
      expect((await commentDraftsOf(harness)).map((draft) => draft.body)).toEqual(["One", "Two"]);
    });

    it("fails outside a bb thread", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(comment("--line", "3", "--body", "Hm"), {});

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Not running in a bb thread");
      expect(harness.experimental_hostRpcCalls).toHaveLength(0);
    });
  });

  describe("review comment edit and delete", () => {
    const FILE = "apps/shell/e2e/utils/elements/createTreeGrid.ts";

    async function saveComment(harness: Awaited<ReturnType<typeof setup>>, body: string) {
      const saved = await harness.behavior.runCli(
        ["review", "comment", FILE, "--start-line", "2", "--line", "3", "--body", body],
        { threadId: "thr_1" },
      );
      return saved.stdout.trim().split(" ").at(-1)!;
    }

    it("lists edit and delete in the review help", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(["review", "--help"]);

      expect(result.stdout).toContain("review comment edit");
      expect(result.stdout).toContain("review comment delete");
    });

    it("replaces the body of a comment draft, keeps its line and commit, and tells the open tab", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T10:00:00Z") });
      const harness = await setupWithPr();
      const draftId = await saveComment(harness, "Wrong");
      const [before] = await commentDraftsOf(harness);
      vi.setSystemTime(new Date("2026-09-25T10:00:00Z"));

      const result = await harness.behavior.runCli(
        ["review", "comment", "edit", draftId, "--body", "Right"],
        { threadId: "thr_1" },
      );

      expect(result).toMatchObject({ exitCode: 0, stdout: `Updated comment draft ${draftId}\n` });
      expect(await commentDraftsOf(harness)).toEqual([
        {
          ...before,
          body: "Right",
          updatedAt: Date.parse("2026-09-25T10:00:00Z"),
          source: "agent",
        },
      ]);
      expect(harness.realtimeSignals).toHaveLength(2);
    });

    it("edits a draft that the user wrote", async () => {
      const harness = await setupWithPr();
      const created = (await harness.behavior.callRpc("createCommentDraft", {
        threadId: "thr_1",
        path: FILE,
        side: "RIGHT",
        line: 3,
      })) as { kind: "created"; draftId: string };

      const result = await harness.behavior.runCli(
        ["review", "comment", "edit", created.draftId, "--body", "Agent text"],
        { threadId: "thr_1" },
      );

      expect(result.exitCode).toBe(0);
      expect(await commentDraftsOf(harness)).toEqual([
        expect.objectContaining({ id: created.draftId, body: "Agent text", source: "agent" }),
      ]);
    });

    it("reads the new body from --body-file", async () => {
      const harness = await setupWithPr();
      const draftId = await saveComment(harness, "Wrong");

      await harness.behavior.runCli(
        ["review", "comment", "edit", draftId, "--body-file", "notes.md"],
        { threadId: "thr_1", cwd: "/work/repo" },
      );

      expect(await commentDraftsOf(harness)).toEqual([
        expect.objectContaining({ body: "From file" }),
      ]);
    });

    it("refuses an empty body and keeps the old one", async () => {
      const harness = await setupWithPr();
      const draftId = await saveComment(harness, "Old");

      const result = await harness.behavior.runCli(
        ["review", "comment", "edit", draftId, "--body", " \n"],
        { threadId: "thr_1" },
      );

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Comment is empty");
      expect((await commentDraftsOf(harness)).map((draft) => draft.body)).toEqual(["Old"]);
    });

    it("deletes a comment draft and tells the open tab", async () => {
      const harness = await setupWithPr();
      const draftId = await saveComment(harness, "Wrong");

      const result = await harness.behavior.runCli(["review", "comment", "delete", draftId], {
        threadId: "thr_1",
      });

      expect(result).toMatchObject({ exitCode: 0, stdout: `Deleted comment draft ${draftId}\n` });
      expect(await commentDraftsOf(harness)).toEqual([]);
      expect(harness.realtimeSignals).toHaveLength(2);
    });

    it("lets a new comment be saved after deleting the drafts of an older commit", async () => {
      let headOid = "abc123";
      const harness = await setupWithPr(reviewHost({ headOid: () => headOid }));
      const draftId = await saveComment(harness, "Old");
      headOid = "def456";

      await harness.behavior.runCli(["review", "comment", "delete", draftId], {
        threadId: "thr_1",
      });
      const result = await harness.behavior.runCli(
        ["review", "comment", FILE, "--line", "3", "--body", "New"],
        { threadId: "thr_1" },
      );

      expect(result.exitCode).toBe(0);
      expect(await commentDraftsOf(harness)).toEqual([
        expect.objectContaining({ body: "New", commitOid: "def456" }),
      ]);
    });

    it.each([["edit", "--body", "Hm"], ["delete"]])(
      "fails for an unknown draft id: %s",
      async (command, ...args) => {
        const harness = await setupWithPr();
        await saveComment(harness, "Keep");

        const result = await harness.behavior.runCli(
          ["review", "comment", command!, "nope1234", ...args],
          { threadId: "thr_1" },
        );

        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("Unknown comment draft: nope1234");
        expect(result.stderr).toContain("bb github-insight review list");
        expect((await commentDraftsOf(harness)).map((draft) => draft.body)).toEqual(["Keep"]);
        expect(harness.realtimeSignals).toHaveLength(1);
      },
    );

    it.each([
      ["edit", "abc", "--body", "Hm"],
      ["delete", "abc"],
    ])("fails outside a bb thread: %s", async (...args) => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(["review", "comment", ...args], {});

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Not running in a bb thread");
      expect(harness.experimental_hostRpcCalls).toHaveLength(0);
    });

    it.each([
      ["edit", "abc", "--body", "Hm"],
      ["delete", "abc"],
    ])("fails for a thread without a PR: %s", async (...args) => {
      const harness = await setup({ threads: [{ id: "thr_1", environmentId: "env_1" }] });

      const result = await harness.behavior.runCli(["review", "comment", ...args], {
        threadId: "thr_1",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No pull request for this thread");
    });
  });

  describe("review summary", () => {
    async function summaryOf(harness: Awaited<ReturnType<typeof setup>>) {
      const result = (await harness.behavior.callRpc("getReview", {
        threadId: "thr_1",
      })) as ReviewResult;
      if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
      return result.summaryDraft;
    }

    it("saves the summary draft and tells the open tab", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-24T10:00:00Z") });
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        ["review", "summary", "--body", "Two bugs, see comments."],
        {
          threadId: "thr_1",
        },
      );

      expect(result).toMatchObject({ exitCode: 0, stdout: "Saved summary draft\n" });
      expect(await summaryOf(harness)).toEqual({
        body: "Two bugs, see comments.",
        updatedAt: Date.parse("2026-09-24T10:00:00Z"),
        source: "agent",
      });
      expect(harness.realtimeSignals).toEqual([
        { channel: "review.drafts-updated", payload: { threadId: "thr_1" } },
      ]);
    });

    it("keeps only the second summary", async () => {
      const harness = await setupWithPr();

      await harness.behavior.runCli(["review", "summary", "--body", "First"], {
        threadId: "thr_1",
      });
      await harness.behavior.runCli(["review", "summary", "--body", "Second"], {
        threadId: "thr_1",
      });

      expect(await summaryOf(harness)).toEqual(expect.objectContaining({ body: "Second" }));
    });

    it("reads --body-file relative to the working directory", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(
        ["review", "summary", "--body-file", "summary.md"],
        {
          threadId: "thr_1",
          cwd: "/work/repo",
        },
      );

      expect(result.exitCode).toBe(0);
      expect(harness.experimental_hostRpcCalls).toContainEqual(
        expect.objectContaining({
          method: "readTextFile",
          input: { path: "summary.md", cwd: "/work/repo" },
        }),
      );
      expect(await summaryOf(harness)).toEqual(expect.objectContaining({ body: "From file" }));
    });

    it("refuses an empty summary", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(["review", "summary", "--body", " "], {
        threadId: "thr_1",
      });

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Summary is empty");
      expect(await summaryOf(harness)).toBeNull();
    });

    it("fails outside a bb thread", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(["review", "summary", "--body", "Hm"], {});

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Not running in a bb thread");
    });
  });

  describe("review list with review drafts", () => {
    const FILE = "apps/shell/e2e/utils/elements/createTreeGrid.ts";

    async function setupWithDrafts() {
      const harness = await setupWithPr();
      for (const args of [
        ["--line", "3", "--body", "First"],
        ["--start-line", "146", "--line", "147", "--body", "Second"],
      ]) {
        await harness.behavior.runCli(["review", "comment", FILE, ...args], { threadId: "thr_1" });
      }
      await harness.behavior.runCli(["review", "summary", "--body", "Two notes."], {
        threadId: "thr_1",
      });
      return harness;
    }

    it("adds the comment drafts and the summary to --json", async () => {
      const harness = await setupWithDrafts();

      const result = await harness.behavior.runCli(["review", "list", "--json"], {
        threadId: "thr_1",
      });

      const listed = JSON.parse(result.stdout) as {
        threads: unknown[];
        comments: unknown[];
        summary: unknown;
      };
      expect(listed.threads).toHaveLength(3);
      expect(listed.comments).toEqual([
        {
          id: expect.any(String),
          path: FILE,
          side: "RIGHT",
          line: 3,
          startLine: null,
          body: "First",
          commitOid: "def456",
        },
        {
          id: expect.any(String),
          path: FILE,
          side: "RIGHT",
          line: 147,
          startLine: 146,
          body: "Second",
          commitOid: "def456",
        },
      ]);
      expect(listed.summary).toBe("Two notes.");
    });

    it("has empty comments and a null summary in --json without drafts", async () => {
      const harness = await setupWithPr();

      const result = await harness.behavior.runCli(["review", "list", "--json"], {
        threadId: "thr_1",
      });

      expect(JSON.parse(result.stdout)).toMatchObject({ comments: [], summary: null });
    });

    it("prints the drafts after the threads", async () => {
      const harness = await setupWithDrafts();

      const result = await harness.behavior.runCli(["review", "list"], { threadId: "thr_1" });

      expect(result.stdout).toContain(`\nComment drafts:\n`);
      expect(result.stdout).toMatch(
        new RegExp(`[a-z0-9]{8}  ${FILE}:146-147  RIGHT\\n    Second\\n`),
      );
      expect(result.stdout.endsWith("Summary draft:\n    Two notes.\n")).toBe(true);
    });
  });
});
