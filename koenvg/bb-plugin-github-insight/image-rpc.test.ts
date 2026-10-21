import { describe, expect, it, vi } from "vitest";
import { setup, linkedPr, ok, failed, prHeadResponse } from "./test/plugin-harness";
import { imageBasisKey } from "./core/pr-image-basis";
import type { ReviewResult } from "./contract";
import threads from "./test/fixtures/pr-25259-review-threads.json";

const headSha = "1111111111111111111111111111111111111111";
const baseSha = "2222222222222222222222222222222222222222";
const mergeBaseSha = "3333333333333333333333333333333333333333";
function head(sha = headSha) {
  const response = prHeadResponse({ oid: sha });
  return {
    data: {
      repository: {
        pullRequest: {
          ...response.data.repository.pullRequest,
          baseRefOid: baseSha,
          baseRepository: { owner: { login: "collibra" }, name: "frontend" },
          headRepository: { owner: { login: "fork-owner" }, name: "frontend" },
        },
      },
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(status = "renamed", moving = false, path = "new.png") {
  let reads = 0;
  const harness = await setup({
    threads: [{ id: "thr_1", environmentId: "env_1" }],
    pullRequests: { env_1: linkedPr(43) },
    host: ({ method }) => {
      if (method === "fetchPrHead")
        return ok(
          head(moving && ++reads > 1 ? "4444444444444444444444444444444444444444" : headSha),
        );
      if (method === "fetchPrFiles")
        return ok([{ filename: path, previous_filename: "old.png", status }]);
      if (method === "fetchReviewThreads") return ok(threads);
      if (method === "fetchImageMergeBase") return ok({ merge_base_commit: { sha: mergeBaseSha } });
      if (method === "readPrImage")
        return { kind: "ready", content: "iVBORw0KGgoAAAAA", mime: "image/png", sizeBytes: 12 };
      throw Error(`Unexpected ${method}`);
    },
  });
  const review = (await harness.behavior.callRpc("getReview", { threadId: "thr_1" })) as Extract<
    ReviewResult,
    { kind: "ok" }
  >;
  expect(review.kind).toBe("ok");
  return { harness, review };
}
describe("PR image RPC", () => {
  it.each(["head", "files"])(
    "starts review threads while %s is pending inside the revision bracket",
    async (boundary) => {
      const pending = deferred<unknown>();
      const events: string[] = [];
      let headReads = 0;
      const harness = await setup({
        threads: [{ id: "thr_1", environmentId: "env_1" }],
        pullRequests: { env_1: linkedPr(43) },
        host: ({ method }) => {
          if (method === "fetchPrHead") {
            events.push("head");
            if (++headReads === 1 && boundary === "head") return pending.promise;
            return ok(head());
          }
          if (method === "fetchPrFiles") {
            events.push("files");
            return boundary === "files"
              ? pending.promise
              : ok([{ filename: "new.png", status: "added" }]);
          }
          if (method === "fetchReviewThreads") {
            events.push("threads");
            return ok(threads);
          }
          if (method === "fetchImageMergeBase") {
            events.push("compare");
            return ok({ merge_base_commit: { sha: mergeBaseSha } });
          }
          throw Error(`Unexpected ${method}`);
        },
      });
      const loading = harness.behavior.callRpc("getReview", { threadId: "thr_1" });
      try {
        await vi.waitFor(() =>
          expect(events).toEqual(
            boundary === "head" ? ["head", "threads"] : ["head", "threads", "files"],
          ),
        );
      } finally {
        pending.resolve(
          boundary === "head" ? ok(head()) : ok([{ filename: "new.png", status: "added" }]),
        );
        await loading;
      }
      expect(await loading).toMatchObject({
        kind: "ok",
        head: { oid: headSha },
        files: [{ path: "new.png", previousPath: null, status: "added", patch: null }],
        imageBasis: { headSha, mergeBaseSha },
      });
      expect(events).toEqual(["head", "threads", "files", "head", "compare"]);
    },
  );

  it.each([
    { name: "empty", files: [], expectedFiles: [] },
    {
      name: "text and SVG only",
      files: [
        { filename: "readme.md", status: "modified", patch: "@@ -1 +1 @@\n-old\n+new" },
        { filename: "logo.svg", status: "added" },
      ],
      expectedFiles: [
        {
          path: "readme.md",
          previousPath: null,
          status: "modified",
          patch: "@@ -1 +1 @@\n-old\n+new",
        },
        { path: "logo.svg", previousPath: null, status: "added", patch: null },
      ],
    },
  ])("skips optional image revisions for $name file lists", async ({ files, expectedFiles }) => {
    const calls: string[] = [];
    const harness = await setup({
      threads: [{ id: "thr_1", environmentId: "env_1" }],
      pullRequests: { env_1: linkedPr(43) },
      host: ({ method }) => {
        calls.push(method);
        if (method === "fetchPrHead") return ok(head());
        if (method === "fetchPrFiles") return ok(files);
        if (method === "fetchReviewThreads") return ok(threads);
        throw Error(`Unexpected ${method}`);
      },
    });
    const review = (await harness.behavior.callRpc("getReview", {
      threadId: "thr_1",
    })) as ReviewResult;
    expect(review).toMatchObject({ kind: "ok", head: { oid: headSha }, imageBasis: null });
    if (review.kind !== "ok") throw Error("Expected loaded review");
    expect(review.files).toEqual(expectedFiles);
    expect(calls).toEqual(["fetchPrHead", "fetchReviewThreads", "fetchPrFiles"]);
  });

  it("resolves image basis for a rename whose previous path alone is raster", async () => {
    const { harness, review } = await fixture("renamed", false, "renamed.bin");
    expect(review.imageBasis).toEqual({
      baseRepo: { owner: "collibra", repo: "frontend" },
      headRepo: { owner: "fork-owner", repo: "frontend" },
      baseSha,
      headSha,
      mergeBaseSha,
      hostId: "host-1",
    });
    expect(
      await harness.behavior.callRpc("getPrImage", {
        threadId: "thr_1",
        expectedBasisKey: imageBasisKey(review.imageBasis!),
        path: "renamed.bin",
        side: "before",
      }),
    ).toEqual({ kind: "ready", content: "iVBORw0KGgoAAAAA", mime: "image/png", sizeBytes: 12 });
    expect(
      harness.experimental_hostRpcCalls
        .filter(({ method }) => method === "readPrImage")
        .map(({ input }) => input),
    ).toEqual([{ owner: "collibra", repo: "frontend", sha: mergeBaseSha, path: "old.png" }]);
  });

  it.each(["files", "threads"])(
    "propagates %s failure while its sibling is pending and handles later sibling failure",
    async (failing) => {
      const files = deferred<unknown>();
      const threadRead = deferred<unknown>();
      const events: string[] = [];
      const harness = await setup({
        threads: [{ id: "thr_1", environmentId: "env_1" }],
        pullRequests: { env_1: linkedPr(43) },
        host: ({ method }) => {
          events.push(method);
          if (method === "fetchPrHead") return ok(head());
          if (method === "fetchPrFiles") return files.promise;
          if (method === "fetchReviewThreads") return threadRead.promise;
          throw Error(`Unexpected ${method}`);
        },
      });
      let result: unknown = null;
      const loading = harness.behavior.callRpc("getReview", { threadId: "thr_1" }).then((value) => {
        result = value;
        return value;
      });
      try {
        await vi.waitFor(() =>
          expect(events).toEqual(["fetchPrHead", "fetchReviewThreads", "fetchPrFiles"]),
        );
        (failing === "files" ? files : threadRead).resolve(
          failed({ kind: "failed", message: `${failing} failed` }),
        );
        await vi.waitFor(() =>
          expect(result).toEqual({ kind: "error", message: `${failing} failed` }),
        );
      } finally {
        files.resolve(failed({ kind: "failed", message: "files failed" }));
        threadRead.resolve(failed({ kind: "failed", message: "threads failed" }));
        await loading;
      }
    },
  );
  it("uses the true merge base and private fork host identity, not base tip", async () => {
    const { harness, review } = await fixture();
    expect(review.imageBasis).toEqual({
      baseRepo: { owner: "collibra", repo: "frontend" },
      headRepo: { owner: "fork-owner", repo: "frontend" },
      baseSha,
      headSha,
      mergeBaseSha,
      hostId: "host-1",
    });
    for (const side of ["before", "after"])
      expect(
        await harness.behavior.callRpc("getPrImage", {
          threadId: "thr_1",
          expectedBasisKey: imageBasisKey(review.imageBasis!),
          path: "new.png",
          side,
        }),
      ).toEqual({ kind: "ready", content: "iVBORw0KGgoAAAAA", mime: "image/png", sizeBytes: 12 });
    expect(
      harness.experimental_hostRpcCalls
        .filter(({ method }) => method === "readPrImage")
        .map(({ input, hostId }) => ({ input, hostId })),
    ).toEqual([
      {
        hostId: "host-1",
        input: { owner: "collibra", repo: "frontend", sha: mergeBaseSha, path: "old.png" },
      },
      {
        hostId: "host-1",
        input: { owner: "fork-owner", repo: "frontend", sha: headSha, path: "new.png" },
      },
    ]);
  });
  it.each([
    ["added", "before"],
    ["removed", "after"],
  ])("does not fetch absent %s %s", async (status, side) => {
    const { harness, review } = await fixture(status);
    expect(
      await harness.behavior.callRpc("getPrImage", {
        threadId: "thr_1",
        expectedBasisKey: imageBasisKey(review.imageBasis!),
        path: "new.png",
        side,
      }),
    ).toEqual({ kind: "absent" });
    expect(
      harness.experimental_hostRpcCalls.filter(({ method }) => method === "readPrImage"),
    ).toEqual([]);
  });
  it("rejects unlisted paths and stale basis", async () => {
    const { harness, review } = await fixture();
    for (const [path, key] of [
      ["other.png", imageBasisKey(review.imageBasis!)],
      ["new.png", "old-basis"],
    ])
      expect(
        await harness.behavior.callRpc("getPrImage", {
          threadId: "thr_1",
          expectedBasisKey: key,
          path,
          side: "after",
        }),
      ).toMatchObject({ kind: "error", code: "stale" });
  });
  it("retries file pagination when the PR head moves", async () => {
    const { harness, review } = await fixture("renamed", true);
    expect(review.imageBasis?.headSha).toBe("4444444444444444444444444444444444444444");
    expect(
      harness.experimental_hostRpcCalls.filter(({ method }) => method === "fetchPrFiles"),
    ).toHaveLength(2);
  });
});
