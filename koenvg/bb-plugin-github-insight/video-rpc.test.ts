import { describe, expect, it } from "vitest";
import { setup, linkedPr, ok, prHeadResponse } from "./test/plugin-harness";
import { imageBasisKey } from "./core/pr-image-basis";
import type { ReviewResult } from "./contract";
import threads from "./test/fixtures/pr-25259-review-threads.json";

const headSha = "1111111111111111111111111111111111111111";
const baseSha = "2222222222222222222222222222222222222222";
const mergeBaseSha = "3333333333333333333333333333333333333333";
const ready = { kind: "ready", mime: "video/webm", content: "GkXfow==", sizeBytes: 4 };
async function fixture(status = "renamed", path = "new.webm") {
  const raw = prHeadResponse({ oid: headSha });
  const harness = await setup({
    threads: [{ id: "thr_1", environmentId: "env_1" }],
    pullRequests: { env_1: linkedPr(43) },
    host: ({ method }) => {
      if (method === "fetchPrHead")
        return ok({
          data: {
            repository: {
              pullRequest: {
                ...raw.data.repository.pullRequest,
                baseRefOid: baseSha,
                baseRepository: { owner: { login: "collibra" }, name: "frontend" },
                headRepository: { owner: { login: "private-fork" }, name: "frontend" },
              },
            },
          },
        });
      if (method === "fetchPrFiles")
        return ok([{ filename: path, previous_filename: "old.mp4", status }]);
      if (method === "fetchReviewThreads") return ok(threads);
      if (method === "fetchImageMergeBase") return ok({ merge_base_commit: { sha: mergeBaseSha } });
      if (method === "readPrVideo") return ready;
      throw Error(`Unexpected ${method}`);
    },
  });
  const review = (await harness.behavior.callRpc("getReview", { threadId: "thr_1" })) as Extract<
    ReviewResult,
    { kind: "ok" }
  >;
  expect(review.kind).toBe("ok");
  expect(
    harness.experimental_hostRpcCalls.filter(({ method }) => method === "readPrVideo"),
  ).toHaveLength(0);
  return {
    harness,
    review,
    request: { threadId: "thr_1", expectedBasisKey: imageBasisKey(review.imageBasis!), path },
  };
}
describe("PR video public loader", () => {
  it.each(["renamed", "copied"])(
    "pins %s sides to the merge base and private fork on the actual host",
    async (status) => {
      const { harness, request, review } = await fixture(status);
      expect(review.imageBasis).toEqual({
        baseRepo: { owner: "collibra", repo: "frontend" },
        headRepo: { owner: "private-fork", repo: "frontend" },
        baseSha,
        headSha,
        mergeBaseSha,
        hostId: "host-1",
      });
      for (const side of ["before", "after"])
        expect(await harness.behavior.callRpc("getPrVideo", { ...request, side })).toEqual(ready);
      expect(
        harness.experimental_hostRpcCalls
          .filter(({ method }) => method === "readPrVideo")
          .map(({ hostId, input }) => ({ hostId, input })),
      ).toEqual([
        {
          hostId: "host-1",
          input: { owner: "collibra", repo: "frontend", sha: mergeBaseSha, path: "old.mp4" },
        },
        {
          hostId: "host-1",
          input: { owner: "private-fork", repo: "frontend", sha: headSha, path: "new.webm" },
        },
      ]);
      expect(
        harness.experimental_hostRpcCalls.filter(({ method }) => method === "readPrImage"),
      ).toHaveLength(0);
    },
  );
  it.each([
    ["added", "before"],
    ["removed", "after"],
  ])("preserves absent %s %s", async (status, side) => {
    const { harness, request } = await fixture(status);
    expect(await harness.behavior.callRpc("getPrVideo", { ...request, side })).toEqual({
      kind: "absent",
    });
    expect(
      harness.experimental_hostRpcCalls.filter(({ method }) => method === "readPrVideo"),
    ).toHaveLength(0);
  });
  it("rejects unlisted files and stale basis without reading video", async () => {
    const { harness, request } = await fixture();
    expect(
      await harness.behavior.callRpc("getPrVideo", {
        ...request,
        path: "secret.mp4",
        side: "after",
      }),
    ).toMatchObject({ kind: "error", code: "stale" });
    expect(
      await harness.behavior.callRpc("getPrVideo", {
        ...request,
        expectedBasisKey: "old",
        side: "before",
      }),
    ).toMatchObject({ kind: "error", code: "stale" });
    expect(
      harness.experimental_hostRpcCalls.filter(({ method }) => method === "readPrVideo"),
    ).toHaveLength(0);
  });
  it("resolves video revisions when only the previous path has a video suffix", async () => {
    const { harness, request } = await fixture("renamed", "renamed.bin");
    expect(await harness.behavior.callRpc("getPrVideo", { ...request, side: "before" })).toEqual(
      ready,
    );
    expect(await harness.behavior.callRpc("getPrVideo", { ...request, side: "after" })).toEqual(
      ready,
    );
  });
});
