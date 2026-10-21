import { describe, expect, it } from "vitest";
import prFiles from "../test/fixtures/pr-25259-files.json";
import reviewThreads from "../test/fixtures/pr-25259-review-threads.json";
import {
  ATTACHMENT_URL,
  reviewThreadsWithAttachment,
  SIGNED_ATTACHMENT_URL,
} from "../test/attachment";
import { failed, linkedPr, ok, prHeadResponse, setup, type HostCall } from "../test/plugin-harness";

const PLACED = "PRRT_kwDOHI7l-86jxula";
const OUTDATED = "PRRT_kwDOHI7l-86jx0SN";
const RESOLVED = "PRRT_kwDOHI7l-86jvKxS";

function reviewHost({ method }: HostCall) {
  if (method === "fetchPrFiles") return ok(prFiles[0]);
  if (method === "fetchReviewThreads") return ok(reviewThreads);
  if (method === "fetchPrHead") return ok(prHeadResponse());
  throw new Error(`unexpected host call ${method}`);
}

function setupWithPr(host: (call: HostCall) => unknown = reviewHost) {
  return setup({
    threads: [{ id: "thr_1", environmentId: "env_1" }],
    pullRequests: { env_1: linkedPr(25259) },
    host,
  });
}

function sentText(harness: Awaited<ReturnType<typeof setup>>): string {
  const [[args]] = harness.sdk.callsTo("threads.send") as [
    [{ input: { type: string; text: string }[] }],
  ];
  return args.input.map((item) => item.text).join("");
}

describe("sendToAgent", () => {
  it("sends one message in auto mode to the thread with the selected review threads", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.callRpc("sendToAgent", {
      threadId: "thr_1",
      reviewThreadIds: [PLACED, OUTDATED],
    });

    expect(result).toEqual({ kind: "sent", delivery: "sent", threadCount: 2 });
    expect(harness.sdk.callsTo("threads.send")).toEqual([
      [
        expect.objectContaining({
          threadId: "thr_1",
          mode: "auto",
          input: [expect.objectContaining({ type: "text" })],
        }),
      ],
    ]);
    const text = sentText(harness);
    expect(text).toContain(`## Review thread ${PLACED}`);
    expect(text).toContain(`## Review thread ${OUTDATED}`);
    expect(text).not.toContain("## Review thread PRRT_kwDOHI7l-86jxqt3");
    expect(text).toContain("bb github-insight review draft");
  });

  it("sends the attachment URLs of review comments, not their short-lived signed URLs", async () => {
    const harness = await setupWithPr((call) =>
      call.method === "fetchReviewThreads" ? ok(reviewThreadsWithAttachment()) : reviewHost(call),
    );

    await harness.behavior.callRpc("sendToAgent", { threadId: "thr_1", reviewThreadIds: [PLACED] });

    expect(sentText(harness)).toContain(ATTACHMENT_URL);
    expect(sentText(harness)).not.toContain(SIGNED_ATTACHMENT_URL);
  });

  it("says when the message is queued behind a busy agent", async () => {
    const harness = await setupWithPr();
    harness.sdk.stub("threads.send", async () => ({
      ok: true,
      delivery: "queued",
      queuedMessage: { content: [] },
    }));

    const result = await harness.behavior.callRpc("sendToAgent", {
      threadId: "thr_1",
      reviewThreadIds: [PLACED],
    });

    expect(result).toMatchObject({ kind: "sent", delivery: "queued", threadCount: 1 });
  });

  it("leaves out review threads that are resolved or gone since the tab loaded", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.callRpc("sendToAgent", {
      threadId: "thr_1",
      reviewThreadIds: [PLACED, RESOLVED, "PRRT_gone"],
    });

    expect(result).toEqual({ kind: "sent", delivery: "sent", threadCount: 1 });
    expect(sentText(harness)).not.toContain(RESOLVED);
  });

  it("sends nothing when none of the selected review threads is still open", async () => {
    const harness = await setupWithPr();

    const result = await harness.behavior.callRpc("sendToAgent", {
      threadId: "thr_1",
      reviewThreadIds: [RESOLVED, "PRRT_gone"],
    });

    expect(result).toEqual({
      kind: "error",
      message: "The selected review threads are resolved or gone",
    });
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("sends nothing when the thread has no pull request", async () => {
    const harness = await setup({
      threads: [{ id: "thr_1", environmentId: "env_1" }],
      host: reviewHost,
    });

    const result = await harness.behavior.callRpc("sendToAgent", {
      threadId: "thr_1",
      reviewThreadIds: [PLACED],
    });

    expect(result).toEqual({ kind: "error", message: "No pull request for this thread" });
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("names the gh failure and sends nothing", async () => {
    const harness = await setupWithPr(() => failed({ kind: "gh_logged_out" }));

    const result = await harness.behavior.callRpc("sendToAgent", {
      threadId: "thr_1",
      reviewThreadIds: [PLACED],
    });

    expect(result).toMatchObject({ kind: "error", message: expect.stringContaining("gh") });
    expect(harness.sdk.callsTo("threads.send")).toEqual([]);
  });
});
