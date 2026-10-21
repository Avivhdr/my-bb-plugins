import { describe, expect, it } from "vitest";
import timelines from "../test/fixtures/pr-timelines.json";
import { createMediaSigner } from "../core/signed-media";
import { GhFailureError } from "../github/gh-failure";
import { ATTACHMENT_BODY, ATTACHMENT_HTML, SIGNED_ATTACHMENT_URL } from "../test/attachment";
import type { PrResolution } from "../pr-lookup";
import { createTimelineService } from "./timeline-service";

const target = {
  ref: { owner: "cli", repo: "cli", number: 14578 },
  hostId: "host-1",
  openOnBb: true,
};

type Deps = Parameters<typeof createTimelineService>[0];

function serviceWith(overrides: Partial<Deps> = {}) {
  const pages: unknown[] = [];
  const comments: unknown[] = [];
  const service = createTimelineService({
    resolvePr: async (): Promise<PrResolution> => ({ kind: "pr", target }),
    fetchTimelinePage: async (prTarget, before) => {
      pages.push([prTarget, before]);
      return timelines["cli-14578"];
    },
    addComment: async (prTarget, request) => {
      comments.push([prTarget, request]);
      return { data: {} };
    },
    newCommentBasis: async () => ({ markedAt: null, seen: new Set<string>() }),
    signMedia: (markdown) => markdown,
    ...overrides,
  });
  return { service, pages, comments };
}

const rateLimited = new GhFailureError({ kind: "rate_limited", resetAt: null });

describe("timeline service", () => {
  it("reads the newest page of the thread's PR", async () => {
    const { service, pages } = serviceWith();

    const result = await service.getTimeline("thr_1", null);

    expect(pages).toEqual([[target, null]]);
    expect(result).toMatchObject({ kind: "ok", olderCursor: null, locked: false });
    expect(result.kind === "ok" && result.events.at(-1)?.kind).toBe("merged");
  });

  it("shows the description and comments with the signed URLs of their attachments", async () => {
    const page = structuredClone(timelines["cli-14578"]);
    const { pullRequest } = page.data.repository;
    Object.assign(pullRequest, { body: ATTACHMENT_BODY, bodyHTML: ATTACHMENT_HTML });
    for (const node of pullRequest.timelineItems.nodes)
      if (node.__typename === "IssueComment")
        Object.assign(node, { body: ATTACHMENT_BODY, bodyHTML: ATTACHMENT_HTML });
    const { service } = serviceWith({
      fetchTimelinePage: async () => page,
      signMedia: createMediaSigner(Date.now),
    });

    const result = await service.getTimeline("thr_1", null);

    if (result.kind !== "ok") throw new Error(`expected ok, got ${result.kind}`);
    const signedBody = `![shot](${SIGNED_ATTACHMENT_URL})`;
    expect(result.description.body).toBe(signedBody);
    expect(result.events.find((event) => event.kind === "comment")).toMatchObject({
      body: signedBody,
    });
  });

  it("returns the PR comments from other people after the mark as new", async () => {
    const { service } = serviceWith({
      newCommentBasis: async () => ({
        markedAt: Date.parse("2026-10-06T00:00:00Z"),
        seen: new Set(["IC_kwDODKw3uc8AAAABaFQoVw"]),
      }),
    });

    const result = await service.getTimeline("thr_1", null);

    expect(result).toMatchObject({ kind: "ok", newCommentIds: ["IC_kwDODKw3uc8AAAABZwikEw"] });
    expect(result).not.toHaveProperty("othersComments");
  });

  it("returns no new comments for a PR with no mark", async () => {
    const { service } = serviceWith();

    expect(await service.getTimeline("thr_1", null)).toMatchObject({ newCommentIds: [] });
  });

  it("passes the cursor for older events", async () => {
    const { service, pages } = serviceWith();

    await service.getTimeline("thr_1", "Y3Vy");

    expect(pages).toEqual([[target, "Y3Vy"]]);
  });

  it.each([
    [{ kind: "no_pr" }, { kind: "no_pr" }],
    [
      { kind: "error", message: "no remote" },
      { kind: "error", message: "no remote" },
    ],
  ] as const)("returns %o from the PR lookup as %o", async (resolution, expected) => {
    const { service, pages } = serviceWith({ resolvePr: async () => resolution });

    expect(await service.getTimeline("thr_1", null)).toEqual(expected);
    expect(pages).toEqual([]);
  });

  it("returns a GitHub failure as an error", async () => {
    const { service } = serviceWith({
      fetchTimelinePage: async () => {
        throw rateLimited;
      },
    });

    expect(await service.getTimeline("thr_1", null)).toEqual({
      kind: "error",
      message: expect.stringMatching(/rate limit/i),
    });
  });

  it("posts one comment on the PR node", async () => {
    const { service, comments } = serviceWith();

    const result = await service.addPrComment({
      threadId: "thr_1",
      prNodeId: "PR_1",
      body: "Thanks, fixed",
    });

    expect(result).toEqual({ kind: "ok" });
    expect(comments).toEqual([[target, { subjectId: "PR_1", body: "Thanks, fixed" }]]);
  });

  it("returns a GitHub rejection of a comment as an error", async () => {
    const { service } = serviceWith({
      addComment: async () => {
        throw rateLimited;
      },
    });

    expect(
      await service.addPrComment({ threadId: "thr_1", prNodeId: "PR_1", body: "Thanks" }),
    ).toEqual({ kind: "error", message: expect.stringMatching(/rate limit/i) });
  });

  it("posts nothing for a thread without a PR", async () => {
    const { service, comments } = serviceWith({ resolvePr: async () => ({ kind: "no_pr" }) });

    expect(
      await service.addPrComment({ threadId: "thr_1", prNodeId: "PR_1", body: "Thanks" }),
    ).toEqual({ kind: "error", message: "No pull request for this thread" });
    expect(comments).toEqual([]);
  });
});
