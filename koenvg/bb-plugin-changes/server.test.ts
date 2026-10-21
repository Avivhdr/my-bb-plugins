import { textContextResultSchema } from "./core/text-context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import plugin from "./server";

type Environments = BbPluginApi["sdk"]["environments"];
type StatusResult = Awaited<ReturnType<Environments["status"]>>;
type DiffFilesResult = Awaited<ReturnType<Environments["diffFiles"]>>;
type DiffPatchResult = Awaited<ReturnType<Environments["diffPatch"]>>;
type SendResult = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["send"]>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function status(
  mergeBase: { sha: string; shortSha: string; subject: string }[] | null,
): StatusResult {
  return {
    outcome: "available",
    workspace: {
      branch: { currentBranch: "feature", defaultBranch: "main" },
      mergeBase:
        mergeBase === null
          ? null
          : {
              commits: mergeBase.map((commit) => ({ ...commit, authorName: "Ann", authoredAt: 0 })),
            },
    },
  } as unknown as StatusResult;
}

const COMMIT = { sha: "abc1234def", shortSha: "abc1234", subject: "feat: add a" };

const AVAILABLE_FILES = {
  outcome: "available",
  files: [
    {
      path: "src/a.ts",
      previousPath: null,
      additions: 3,
      deletions: 1,
      binary: false,
      loadMode: "auto",
      changeKind: "modified",
      origin: "tracked",
    },
    {
      path: "logo.png",
      previousPath: null,
      additions: 0,
      deletions: 0,
      binary: true,
      loadMode: "auto",
      changeKind: "added",
      origin: "untracked",
    },
    {
      path: "big.json",
      previousPath: null,
      additions: 9000,
      deletions: 0,
      binary: false,
      loadMode: "too_large",
      changeKind: "added",
      origin: "tracked",
    },
    {
      path: "src/new.ts",
      previousPath: "src/old.ts",
      additions: 2,
      deletions: 2,
      binary: false,
      loadMode: "on_demand",
      changeKind: "renamed",
      origin: "tracked",
    },
  ],
  initialPatches: [{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n", truncated: false }],
  mergeBaseRef: "main",
  shortstat: "4 files changed",
  truncated: false,
} as DiffFilesResult;

interface Calls {
  status: unknown[];
  diffFiles: unknown[];
  diffPatch: unknown[];
  send: unknown[];
}

let dispose: (() => Promise<void>) | undefined;

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

async function setup(
  options: {
    environmentId?: string | null;
    status?: (args: { mergeBaseBranch?: string }) => StatusResult | Promise<StatusResult>;
    diffFiles?: DiffFilesResult | Error | (() => Promise<DiffFilesResult>);
    diffPatch?: DiffPatchResult;
    diffFile?: (args: unknown) => Promise<{
      content: string;
      contentEncoding: "base64" | "utf8";
      sizeBytes: number;
      path?: string;
    }>;
    send?: SendResult | Error;
    remoteBranches?: string[];
    kv?: Record<string, unknown>;
  } = {},
) {
  const calls: Calls = { status: [], diffFiles: [], diffPatch: [], send: [] };
  const { bb, harness } = createFakePluginHost({
    pluginId: "changes",
    sdk: {
      threads: {
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            environmentId: options.environmentId === undefined ? "env-1" : options.environmentId,
          }),
        send: async (args) => {
          calls.send.push(args);
          if (options.send instanceof Error) throw options.send;
          return options.send ?? { ok: true as const, delivery: "sent" as const };
        },
      },
      environments: {
        diffFile:
          options.diffFile ??
          (async () => ({
            content: "iVBORw0KGgoAAAAA",
            contentEncoding: "base64" as const,
            sizeBytes: 12,
          })),
        status: async (args) => {
          calls.status.push(args);
          return (
            options.status ??
            ((query) => status(query.mergeBaseBranch === undefined ? null : [COMMIT]))
          )(args);
        },
        diffBranches: async () => ({
          branches: ["main"],
          branchesTruncated: false,
          remoteBranches: options.remoteBranches ?? ["origin/main"],
          remoteBranchesTruncated: false,
          selectedBranch: null,
        }),
        diffFiles: async (args) => {
          calls.diffFiles.push(args);
          if (options.diffFiles instanceof Error) throw options.diffFiles;
          if (typeof options.diffFiles === "function") return options.diffFiles();
          return options.diffFiles ?? AVAILABLE_FILES;
        },
        diffPatch: async (args) => {
          calls.diffPatch.push(args);
          return (
            options.diffPatch ?? {
              outcome: "available",
              patches: [{ path: "src/new.ts", patch: "@@ -1 +1 @@\n-x\n+y\n", truncated: false }],
            }
          );
        },
      },
    },
  });
  for (const [key, value] of Object.entries(options.kv ?? {})) await bb.storage.kv.set(key, value);
  await plugin(bb);
  dispose = () => harness.dispose();
  return { harness, calls, kv: bb.storage.kv };
}
describe("getTextContext", () => {
  const file = {
    path: "a.txt",
    previousPath: null,
    additions: 1,
    deletions: 1,
    binary: false,
    loadMode: "auto",
    status: "modified",
  };
  const basis = {
    environmentId: "env-1",
    headSha: "a".repeat(40),
    mergeBaseRef: "b".repeat(40),
    target: { kind: "all" },
  };
  const patch = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -2 +2 @@\n-old\n+new\n";
  const request = { threadId: "thr-1", basis, file, patch };
  const readArgs: Record<string, unknown>[] = [];
  const read = async (args: unknown) => {
    const input = args as Record<string, unknown>;
    readArgs.push(input);
    const content = input.target === "commit" ? "prefix\nold\nsuffix\n" : "prefix\nnew\nsuffix\n";
    return {
      path: String(input.path),
      content,
      contentEncoding: "utf8" as const,
      sizeBytes: Buffer.byteLength(content),
    };
  };
  beforeEach(() => {
    readArgs.length = 0;
  });
  it.each(["all", "uncommitted", "branch_committed", "commit"])(
    "reads the captured %s revisions",
    async (kind) => {
      const reader = async (args: unknown) => {
        const input = args as Record<string, unknown>;
        readArgs.push(input);
        const content = readArgs.length === 1 ? "prefix\nold\nsuffix\n" : "prefix\nnew\nsuffix\n";
        return {
          path: "a.txt",
          content: Buffer.from(content).toString("base64"),
          contentEncoding: "base64" as const,
          sizeBytes: Buffer.byteLength(content),
        };
      };
      const { harness } = await setup({ diffFile: reader });
      const target = kind === "commit" ? { kind, sha: "c".repeat(40) } : { kind };
      const result = textContextResultSchema.parse(
        await harness.callRpc("getTextContext", { ...request, basis: { ...basis, target } }),
      );
      expect(result.kind).toBe("ready");
      if (result.kind !== "ready") throw new Error(result.message);
      expect(result.new.kind === "text" ? result.new.contents : "absent").toBe(
        "prefix\nnew\nsuffix\n",
      );
      expect(readArgs).toEqual([
        {
          environmentId: "env-1",
          path: "a.txt",
          target: "commit",
          sha:
            kind === "commit"
              ? "c".repeat(40)
              : kind === "uncommitted"
                ? "a".repeat(40)
                : "b".repeat(40),
          side: kind === "commit" ? "old" : "new",
        },
        kind === "all" || kind === "uncommitted"
          ? { environmentId: "env-1", path: "a.txt", target: "uncommitted", side: "new" }
          : {
              environmentId: "env-1",
              path: "a.txt",
              target: "commit",
              sha: kind === "commit" ? "c".repeat(40) : "a".repeat(40),
              side: "new",
            },
      ]);
    },
  );
  it("reads the previous rename path", async () => {
    const { harness } = await setup({ diffFile: read });
    const result = await harness.callRpc("getTextContext", {
      ...request,
      file: { ...file, previousPath: "old.txt", status: "renamed" },
      patch: patch.replaceAll("a/a.txt", "a/old.txt"),
    });
    expect(textContextResultSchema.parse(result).kind).toBe("ready");
    expect(readArgs.map((args) => args.path)).toEqual(["old.txt", "a.txt"]);
  });
  it.each(["added", "untracked", "deleted"])("does not read the absent %s side", async (status) => {
    const content = status === "deleted" ? "old\n" : "new\n";
    const { harness } = await setup({
      diffFile: async (args) => {
        readArgs.push(args as Record<string, unknown>);
        return { path: "a.txt", content, contentEncoding: "utf8", sizeBytes: 4 };
      },
    });
    const p =
      status === "deleted"
        ? "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-old\n"
        : "diff --git a/a.txt b/a.txt\n--- /dev/null\n+++ b/a.txt\n@@ -0,0 +1 @@\n+new\n";
    const result = textContextResultSchema.parse(
      await harness.callRpc("getTextContext", { ...request, file: { ...file, status }, patch: p }),
    );
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") throw new Error(result.message);
    expect(result[status === "deleted" ? "new" : "old"]).toEqual({ kind: "absent" });
    expect(readArgs).toHaveLength(1);
  });
  it("refuses an environment mismatch before any file read", async () => {
    const { harness } = await setup({ environmentId: "other", diffFile: read });
    expect(await harness.callRpc("getTextContext", request)).toEqual({
      kind: "error",
      code: "stale",
      message: "Environment changed. Refresh changes.",
    });
    expect(readArgs).toEqual([]);
  });
  it("checks environment ownership again after reading both sides", async () => {
    const options = {
      environmentId: "env-1",
      diffFile: async (args: unknown) => {
        options.environmentId = "env-moved";
        return read(args);
      },
    };
    const { harness } = await setup(options);
    expect(await harness.callRpc("getTextContext", request)).toEqual({
      kind: "error",
      code: "stale",
      message: "Environment changed. Refresh changes.",
    });
    expect(readArgs.map((args) => args.path)).toEqual(["a.txt", "a.txt"]);
  });
  it("requires immutable revisions rather than branch names", async () => {
    const { harness } = await setup({ diffFile: read });
    expect(
      await harness.callRpc("getTextContext", {
        ...request,
        basis: { ...basis, mergeBaseRef: "main" },
      }),
    ).toEqual({
      kind: "error",
      code: "stale",
      message: "Context revision unavailable. Refresh changes.",
    });
  });
  it.each([
    ["wrong path", { path: "other" }, "Context path changed. Refresh changes."],
    ["byte mismatch", { sizeBytes: 0 }, "Context is not valid UTF-8 text."],
    [
      "invalid base64",
      { contentEncoding: "base64", content: "!!!!" },
      "Context is not valid UTF-8 text.",
    ],
    [
      "invalid UTF-8",
      { contentEncoding: "base64", content: "/w==", sizeBytes: 1 },
      "Context is not valid UTF-8 text.",
    ],
    [
      "oversized side",
      { sizeBytes: 1024 * 1024 + 1 },
      "Context exceeds the 1 MiB or 20,000 line limit.",
    ],
    [
      "too many lines",
      { content: "x\n".repeat(20_001), sizeBytes: 40_002 },
      "Context exceeds the 1 MiB or 20,000 line limit.",
    ],
    [
      "outside-hunk drift",
      { content: "drift\nnew\nsuffix\n", sizeBytes: 17 },
      "Context does not match this diff. Refresh changes.",
    ],
  ])("rejects %s and retains a recoverable error", async (_label, override, message) => {
    const { harness } = await setup({
      diffFile: async (args) =>
        ({ ...(await read(args)), ...override }) as Awaited<ReturnType<typeof read>>,
    });
    const result = await harness.callRpc("getTextContext", request);
    expect(result).toMatchObject({ kind: "error", message });
  });
});
describe("getImage", () => {
  const file = {
    path: "new.png",
    previousPath: "old.png",
    status: "renamed",
    binary: true,
    additions: 0,
    deletions: 0,
    loadMode: "auto",
  };
  const headSha = "1111111111111111111111111111111111111111";
  const mergeBaseRef = "2222222222222222222222222222222222222222";
  it.each([
    ["all", "before", { target: "commit", sha: mergeBaseRef, side: "new", path: "old.png" }],
    ["all", "after", { target: "uncommitted", side: "new", path: "new.png" }],
    ["uncommitted", "before", { target: "commit", sha: headSha, side: "new", path: "old.png" }],
    ["branch_committed", "after", { target: "commit", sha: headSha, side: "new", path: "new.png" }],
    ["commit", "before", { target: "commit", sha: mergeBaseRef, side: "old", path: "old.png" }],
    ["uncommitted", "after", { target: "uncommitted", side: "new", path: "new.png" }],
    [
      "branch_committed",
      "before",
      { target: "commit", sha: mergeBaseRef, side: "new", path: "old.png" },
    ],
    ["commit", "after", { target: "commit", sha: mergeBaseRef, side: "new", path: "new.png" }],
  ])("pins %s %s", async (kind, side, expected) => {
    const calls: unknown[] = [];
    const { harness } = await setup({
      diffFile: async (args) => {
        calls.push(args);
        return { content: "iVBORw0KGgoAAAAA", contentEncoding: "base64", sizeBytes: 12 };
      },
    });
    const result = await harness.callRpc("getImage", {
      threadId: "thr_1",
      basis: {
        environmentId: "env-1",
        headSha,
        mergeBaseRef,
        target: kind === "commit" ? { kind, sha: mergeBaseRef } : { kind },
      },
      file,
      side,
    });
    expect(result).toEqual({
      kind: "ready",
      content: "iVBORw0KGgoAAAAA",
      mime: "image/png",
      sizeBytes: 12,
    });
    expect(calls).toEqual([{ environmentId: "env-1", ...expected }]);
  });
  it.each([
    ["added", "before"],
    ["untracked", "before"],
    ["deleted", "after"],
  ])("does not read absent %s %s", async (status, side) => {
    const calls: unknown[] = [];
    const { harness } = await setup({
      diffFile: async (args) => {
        calls.push(args);
        throw Error("not called");
      },
    });
    expect(
      await harness.callRpc("getImage", {
        threadId: "thr_1",
        basis: { environmentId: "env-1", headSha, mergeBaseRef, target: { kind: "all" } },
        file: { ...file, status },
        side,
      }),
    ).toEqual({ kind: "absent" });
    expect(calls).toEqual([]);
  });
  it("rejects environment mismatches", async () => {
    const { harness } = await setup();
    expect(
      await harness.callRpc("getImage", {
        threadId: "thr_1",
        basis: { environmentId: "other", headSha, mergeBaseRef, target: { kind: "all" } },
        file,
        side: "after",
      }),
    ).toMatchObject({ kind: "error", code: "stale" });
  });
  it("reads a copied image from its previous path", async () => {
    const calls: unknown[] = [];
    const { harness } = await setup({
      diffFile: async (args) => {
        calls.push(args);
        return { content: "iVBORw0KGgoAAAAA", contentEncoding: "base64", sizeBytes: 12 };
      },
    });
    await harness.callRpc("getImage", {
      threadId: "thr_1",
      basis: { environmentId: "env-1", headSha, mergeBaseRef, target: { kind: "all" } },
      file: { ...file, status: "copied" },
      side: "before",
    });
    expect(calls).toEqual([
      { environmentId: "env-1", path: "old.png", target: "commit", sha: mergeBaseRef, side: "new" },
    ]);
  });
  it.each(["../secret.png", "/absolute.png", "dir/../secret.png", "dir\\secret.png"])(
    "rejects unsafe paths without an SDK content read: %s",
    async (path) => {
      const calls: unknown[] = [];
      const { harness } = await setup({
        diffFile: async (args) => {
          calls.push(args);
          throw Error("not called");
        },
      });
      expect(
        await harness.callRpc("getImage", {
          threadId: "thr_1",
          basis: { environmentId: "env-1", headSha, mergeBaseRef, target: { kind: "all" } },
          file: { ...file, path },
          side: "after",
        }),
      ).toMatchObject({ kind: "error", code: "read" });
      expect(calls).toEqual([]);
    },
  );
});

describe("getChanges", () => {
  it("runs branch commits alongside the sequential checkout/file-list bracket", async () => {
    const commits = deferred<StatusResult>();
    const files = deferred<DiffFilesResult>();
    const events: string[] = [];
    let statusReads = 0;
    const { harness } = await setup({
      status: ({ mergeBaseBranch }) => {
        if (mergeBaseBranch !== undefined) {
          events.push("commits");
          return commits.promise;
        }
        if (++statusReads > 1) events.push("head");
        return {
          ...status(null),
          workspace: {
            branch: { currentBranch: "feature", defaultBranch: "main" },
            checkout: {
              kind: "branch",
              branchName: "feature",
              headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            mergeBase: null,
          },
        } as StatusResult;
      },
      diffFiles: () => {
        events.push("files");
        return files.promise;
      },
    });
    const loading = harness.callRpc("getChanges", { threadId: "thr_1", target: { kind: "all" } });
    try {
      await vi.waitFor(() => expect(events).toEqual(["commits", "head", "files"]));
      files.resolve({
        ...AVAILABLE_FILES,
        mergeBaseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      } as DiffFilesResult);
      await vi.waitFor(() => expect(events).toEqual(["commits", "head", "files", "head"]));
    } finally {
      files.resolve(AVAILABLE_FILES);
      commits.resolve(status([COMMIT]));
      await loading;
    }
    expect(await loading).toMatchObject({
      kind: "ok",
      imageBasis: {
        environmentId: "env-1",
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        mergeBaseRef: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        target: { kind: "all" },
      },
      patches: { "src/a.ts": "@@ -1 +1 @@\n-a\n+b\n" },
      commits: [{ sha: "abc1234def", shortSha: "abc1234", subject: "feat: add a" }],
    });
  });

  it("returns a bracket failure while branch commits are pending and handles their later failure", async () => {
    const commits = deferred<StatusResult>();
    let commitsStarted = false;
    const { harness } = await setup({
      status: ({ mergeBaseBranch }) => {
        if (mergeBaseBranch !== undefined) {
          commitsStarted = true;
          return commits.promise.then(() => {
            throw Error("commits unavailable");
          });
        }
        return status(null);
      },
      diffFiles: Error("files unavailable"),
    });
    let result: unknown = null;
    const loading = harness
      .callRpc("getChanges", { threadId: "thr_1", target: { kind: "all" } })
      .then((value) => {
        result = value;
        return value;
      });
    try {
      await vi.waitFor(() =>
        expect(result).toEqual({ kind: "error", message: "files unavailable" }),
      );
      expect(commitsStarted).toBe(true);
    } finally {
      commits.resolve(status(null));
      await loading;
    }
  });

  it("brackets moving checkout heads, retries once and retains the actual merge base", async () => {
    let read = 0;
    const { harness, calls } = await setup({
      status: ({ mergeBaseBranch }) => {
        const sha =
          mergeBaseBranch === undefined && ++read >= 3
            ? "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
            : "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        const base = status(null);
        return {
          ...base,
          workspace: {
            branch: { currentBranch: "feature", defaultBranch: "main" },
            checkout: { kind: "branch", branchName: "feature", headSha: sha },
            mergeBase: null,
          },
        } as StatusResult;
      },
      diffFiles: {
        ...AVAILABLE_FILES,
        mergeBaseRef: "cccccccccccccccccccccccccccccccccccccccc",
      } as DiffFilesResult,
    });
    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "branch_committed" },
    });
    expect(result).toMatchObject({
      kind: "ok",
      imageBasis: {
        environmentId: "env-1",
        headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        mergeBaseRef: "cccccccccccccccccccccccccccccccccccccccc",
        target: { kind: "branch_committed" },
      },
    });
    expect(calls.diffFiles).toEqual([
      { environmentId: "env-1", target: "branch_committed", mergeBaseBranch: "origin/main" },
      { environmentId: "env-1", target: "branch_committed", mergeBaseBranch: "origin/main" },
    ]);
  });
  it("keeps text available but disables images if checkout keeps moving", async () => {
    let read = 0;
    const { harness } = await setup({
      status: () =>
        ({
          outcome: "available",
          workspace: {
            branch: { currentBranch: "feature", defaultBranch: "main" },
            checkout: { kind: "detached", headSha: String(++read).padStart(40, "0") },
            mergeBase: null,
          },
        }) as StatusResult,
    });
    expect(
      await harness.callRpc("getChanges", { threadId: "thr_1", target: { kind: "all" } }),
    ).toMatchObject({
      kind: "ok",
      imageBasis: null,
      patches: { "src/a.ts": "@@ -1 +1 @@\n-a\n+b\n" },
    });
  });
  it.each([
    [{ kind: "all" }, { environmentId: "env-1", target: "all", mergeBaseBranch: "origin/main" }],
    [{ kind: "uncommitted" }, { environmentId: "env-1", target: "uncommitted" }],
    [
      { kind: "branch_committed" },
      { environmentId: "env-1", target: "branch_committed", mergeBaseBranch: "origin/main" },
    ],
    [
      { kind: "commit", sha: "abc1234def" },
      { environmentId: "env-1", target: "commit", sha: "abc1234def" },
    ],
  ])("maps target %j to the environment diff query", async (target, expected) => {
    const { harness, calls } = await setup();

    await harness.callRpc("getChanges", { threadId: "thr_1", target });

    expect(calls.diffFiles).toEqual([expected]);
  });

  it("returns the environment resolved from the requested thread", async () => {
    const { harness } = await setup({ environmentId: "env-thread-2" });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_2",
      target: { kind: "uncommitted" },
    });

    expect(result).toMatchObject({
      kind: "ok",
      environmentId: "env-thread-2",
      query: { target: "uncommitted" },
    });
  });

  it("returns files, initial patches, and branch commits", async () => {
    const { harness } = await setup();

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toEqual({
      kind: "ok",
      environmentId: "env-1",
      query: { target: "all", mergeBaseBranch: "origin/main" },
      imageBasis: null,
      files: [
        {
          path: "src/a.ts",
          previousPath: null,
          additions: 3,
          deletions: 1,
          binary: false,
          loadMode: "auto",
          status: "modified",
        },
        {
          path: "logo.png",
          previousPath: null,
          additions: 0,
          deletions: 0,
          binary: true,
          loadMode: "auto",
          status: "untracked",
        },
        {
          path: "big.json",
          previousPath: null,
          additions: 9000,
          deletions: 0,
          binary: false,
          loadMode: "too_large",
          status: "added",
        },
        {
          path: "src/new.ts",
          previousPath: "src/old.ts",
          additions: 2,
          deletions: 2,
          binary: false,
          loadMode: "on_demand",
          status: "renamed",
        },
      ],
      patches: { "src/a.ts": "@@ -1 +1 @@\n-a\n+b\n" },
      commits: [COMMIT],
    });
  });

  it("compares against the remote default branch", async () => {
    const { harness, calls } = await setup();

    await harness.callRpc("getChanges", { threadId: "thr_1", target: { kind: "all" } });

    expect(calls.status).toEqual([
      { environmentId: "env-1" },
      { environmentId: "env-1", mergeBaseBranch: "origin/main" },
      { environmentId: "env-1" },
      { environmentId: "env-1" },
    ]);
  });

  it("falls back to the local default branch without a remote one", async () => {
    const { harness, calls } = await setup({ remoteBranches: [] });

    await harness.callRpc("getChanges", { threadId: "thr_1", target: { kind: "all" } });

    expect(calls.diffFiles).toEqual([
      { environmentId: "env-1", target: "all", mergeBaseBranch: "main" },
    ]);
  });

  it("still returns the diff when bb fails to list the branch commits", async () => {
    const { harness } = await setup({
      status: (query) => {
        if (query.mergeBaseBranch !== undefined) throw new Error("HTTP 502: invalid commits");
        return status(null);
      },
    });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toMatchObject({ kind: "ok", commits: [] });
  });

  it("reports a thread without an environment as an error", async () => {
    const { harness } = await setup({ environmentId: null });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toEqual({ kind: "error", message: "This thread has no environment" });
  });

  it("reports a non-git environment as no_git", async () => {
    const { harness } = await setup({
      status: () =>
        ({
          outcome: "not_applicable",
          reason: "non_git_environment",
          message: "Not a git environment",
        }) as StatusResult,
    });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toEqual({ kind: "no_git" });
  });

  it("reports a deleted file as deleted", async () => {
    const { harness } = await setup({
      diffFiles: {
        ...AVAILABLE_FILES,
        files: [
          {
            path: "gone.ts",
            previousPath: null,
            additions: 0,
            deletions: 4,
            binary: false,
            loadMode: "auto",
            changeKind: "deleted",
            origin: "tracked",
          },
        ],
      } as DiffFilesResult,
    });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toMatchObject({ kind: "ok", files: [{ path: "gone.ts", status: "deleted" }] });
  });

  it("keeps the message of an unavailable diff", async () => {
    const { harness } = await setup({
      diffFiles: {
        outcome: "unavailable",
        failure: { code: "permission_denied", message: "permission denied", workspacePath: "/w" },
      },
    });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toEqual({ kind: "error", message: "permission denied" });
  });

  it("returns a thrown error as an error result", async () => {
    const { harness } = await setup({ diffFiles: new Error("daemon gone") });

    const result = await harness.callRpc("getChanges", {
      threadId: "thr_1",
      target: { kind: "all" },
    });

    expect(result).toEqual({ kind: "error", message: "daemon gone" });
  });
});

describe("getPatches", () => {
  it.each([
    [
      { target: "all", mergeBaseBranch: "origin/main" },
      { type: "all", mergeBaseBranch: "origin/main" },
    ],
    [{ target: "uncommitted" }, { type: "uncommitted" }],
    [
      { target: "commit", sha: "abc1234def" },
      { type: "commit", sha: "abc1234def" },
    ],
  ])("asks for the patches of the requested paths with query %j", async (query, target) => {
    const { harness, calls } = await setup();

    await harness.callRpc("getPatches", { threadId: "thr_1", query, paths: ["src/new.ts"] });

    expect(calls.diffPatch).toEqual([{ environmentId: "env-1", paths: ["src/new.ts"], target }]);
    expect(calls.status).toEqual([]);
  });

  it("returns the patches per path", async () => {
    const { harness } = await setup();

    const result = await harness.callRpc("getPatches", {
      threadId: "thr_1",
      query: { target: "uncommitted" },
      paths: ["src/new.ts"],
    });

    expect(result).toEqual({ kind: "ok", patches: { "src/new.ts": "@@ -1 +1 @@\n-x\n+y\n" } });
  });
});

describe("sendFeedback", () => {
  it.each(["sent", "queued"] as const)("returns the %s delivery", async (delivery) => {
    const { harness, calls } = await setup({ send: { ok: true, delivery } as SendResult });

    const result = await harness.callRpc("sendFeedback", { threadId: "thr_1", text: "Fix it" });

    expect(result).toEqual({ kind: "sent", delivery });
    expect(calls.send).toEqual([
      { threadId: "thr_1", mode: "auto", input: [{ type: "text", text: "Fix it", mentions: [] }] },
    ]);
  });

  it("rejects blank text", async () => {
    const { harness, calls } = await setup();

    await expect(
      harness.callRpc("sendFeedback", { threadId: "thr_1", text: "  " }),
    ).rejects.toThrow();
    expect(calls.send).toEqual([]);
  });

  it("returns a thrown error as an error result", async () => {
    const { harness } = await setup({ send: new Error("thread archived") });

    const result = await harness.callRpc("sendFeedback", { threadId: "thr_1", text: "Fix it" });

    expect(result).toEqual({ kind: "error", message: "thread archived" });
  });
});

describe("viewed marks", () => {
  const ALL = { kind: "all" } as const;
  const KEY = "viewed:v1:thr_1:all";

  it("reads the marks of a thread and target", async () => {
    const { harness } = await setup({
      kv: {
        [KEY]: { v: 1, marks: { "src/a.ts": "5:aaaa" } },
        "viewed:v1:thr_1:uncommitted": { v: 1, marks: { "src/b.ts": "5:bbbb" } },
      },
    });

    const result = await harness.callRpc("getViewed", { threadId: "thr_1", target: ALL });

    expect(result).toEqual({ kind: "ok", marks: { "src/a.ts": "5:aaaa" } });
  });

  it("reads a bad stored value as no marks", async () => {
    const { harness } = await setup({ kv: { [KEY]: { v: 2, marks: "?" } } });

    const result = await harness.callRpc("getViewed", { threadId: "thr_1", target: ALL });

    expect(result).toEqual({ kind: "ok", marks: {} });
  });

  it("sets and removes marks in one update, per commit sha", async () => {
    const commit = { kind: "commit", sha: "abc1234def" } as const;
    const { harness, kv } = await setup({
      kv: {
        "viewed:v1:thr_1:commit:abc1234def": {
          v: 1,
          marks: { "src/a.ts": "5:aaaa", "src/b.ts": "5:bbbb" },
        },
      },
    });

    const result = await harness.callRpc("updateViewed", {
      threadId: "thr_1",
      target: commit,
      set: { "src/c.ts": "5:cccc" },
      remove: ["src/a.ts"],
    });

    expect(result).toEqual({ kind: "ok" });
    expect(await kv.get("viewed:v1:thr_1:commit:abc1234def")).toEqual({
      v: 1,
      marks: { "src/b.ts": "5:bbbb", "src/c.ts": "5:cccc" },
    });
  });

  it("deletes the key when no marks are left", async () => {
    const { harness, kv } = await setup({
      kv: { [KEY]: { v: 1, marks: { "src/a.ts": "5:aaaa" } } },
    });

    await harness.callRpc("updateViewed", {
      threadId: "thr_1",
      target: ALL,
      set: {},
      remove: ["src/a.ts"],
    });

    expect(await kv.list("viewed:")).toEqual([]);
  });

  it("keeps both changes of two parallel updates", async () => {
    const { harness, kv } = await setup();

    await Promise.all([
      harness.callRpc("updateViewed", {
        threadId: "thr_1",
        target: ALL,
        set: { "src/a.ts": "5:aaaa" },
        remove: [],
      }),
      harness.callRpc("updateViewed", {
        threadId: "thr_1",
        target: ALL,
        set: { "src/b.ts": "5:bbbb" },
        remove: [],
      }),
    ]);

    expect(await kv.get(KEY)).toEqual({
      v: 1,
      marks: { "src/a.ts": "5:aaaa", "src/b.ts": "5:bbbb" },
    });
  });

  it("returns a storage error as an error result", async () => {
    const { harness, kv } = await setup();
    kv.set = async () => {
      throw new Error("disk full");
    };

    const result = await harness.callRpc("updateViewed", {
      threadId: "thr_1",
      target: ALL,
      set: { "src/a.ts": "5:aaaa" },
      remove: [],
    });

    expect(result).toEqual({ kind: "error", message: "disk full" });
  });
});
