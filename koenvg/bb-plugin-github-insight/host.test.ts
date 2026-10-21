import { beforeEach, describe, expect, it, vi } from "vitest";

const ghStdout = vi.hoisted(() => ({ value: "" }));
const ghFailures = vi.hoisted(() => [] as object[]);
const ghCalls = vi.hoisted(() => [] as string[][]);

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: (_file: string, args: string[]) => {
      ghCalls.push(args);
      const failure = ghFailures.shift();
      return Object.assign(
        failure === undefined
          ? Promise.resolve({ stdout: ghStdout.value })
          : Promise.reject(failure),
        { child: { stdin: { end: () => undefined } } },
      );
    },
  });
  return { execFile };
});

const { default: host } = await import("./host");

function rateLimitResponse(remaining: number) {
  return JSON.stringify({ resources: { graphql: { remaining, reset: 1_790_000_000 } } });
}

async function readRateLimitReset() {
  const context = { signal: new AbortController().signal } as Parameters<
    typeof host.handlers.readRateLimitReset
  >[1];
  return host.handlers.readRateLimitReset({}, context);
}

describe("readRateLimitReset", () => {
  it("returns the GraphQL reset time when the quota is used up", async () => {
    ghStdout.value = rateLimitResponse(0);
    expect(await readRateLimitReset()).toEqual({ resetAt: 1_790_000_000_000 });
  });

  it("returns null while quota remains", async () => {
    ghStdout.value = rateLimitResponse(12);
    expect(await readRateLimitReset()).toEqual({ resetAt: null });
  });
});

describe("fetchPrFiles", () => {
  it("returns less than the 8 MiB host output cap when the patches add up to more", async () => {
    const files = Array.from({ length: 100 }, (_, index) => ({
      filename: `src/file-${index}.ts`,
      status: "modified",
      patch: "+".repeat(200 * 1024),
    }));
    ghStdout.value = JSON.stringify(files);
    const context = { signal: new AbortController().signal } as Parameters<
      typeof host.handlers.fetchPrFiles
    >[1];

    const result = await host.handlers.fetchPrFiles(
      { owner: "o", repo: "r", number: 1, page: 1 },
      context,
    );

    expect(result).toMatchObject({ ok: true });
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(8 * 1024 * 1024);
  });
});

describe("fetchReviewQueue", () => {
  const queueResponse = JSON.stringify({
    data: { viewer: { login: "me" }, reviewRequests: { issueCount: 0, nodes: [] } },
  });
  const timeout = { code: 1, stderr: "gh: HTTP 504\n", stdout: "" };
  const tracked = (count: number) =>
    Array.from({ length: count }, (_, number) => ({ owner: "acme", repo: "api", number }));

  beforeEach(() => {
    ghCalls.length = 0;
    ghFailures.length = 0;
    ghStdout.value = queueResponse;
  });

  async function fetchReviewQueue(count: number) {
    const context = { signal: new AbortController().signal } as Parameters<
      typeof host.handlers.fetchReviewQueue
    >[1];
    return host.handlers.fetchReviewQueue({ tracked: tracked(count) }, context);
  }

  it("asks GitHub in one request per 8 tracked PRs", async () => {
    expect(await fetchReviewQueue(17)).toMatchObject({ ok: true });
    expect(ghCalls).toHaveLength(3);
  });

  it("returns the failure of a batch when the other batches succeed", async () => {
    ghFailures.push({ code: 1, stderr: "gh: HTTP 502\n", stdout: "" });

    expect(await fetchReviewQueue(17)).toEqual({
      ok: false,
      failure: { kind: "failed", message: "gh: HTTP 502" },
    });
  });

  it("returns a rate limit before a plain failure", async () => {
    ghFailures.push(
      { code: 1, stderr: "gh: HTTP 502\n", stdout: "" },
      { code: 1, stderr: "API rate limit exceeded\n", stdout: "" },
    );

    expect(await fetchReviewQueue(9)).toMatchObject({
      ok: false,
      failure: { kind: "rate_limited" },
    });
  });

  it("retries a request once when GitHub times out", async () => {
    ghFailures.push(timeout);

    expect(await fetchReviewQueue(0)).toEqual({ ok: true, data: [JSON.parse(queueResponse)] });
    expect(ghCalls).toHaveLength(2);
  });

  it("fails when GitHub times out twice", async () => {
    ghFailures.push(timeout, timeout);

    expect(await fetchReviewQueue(0)).toEqual({
      ok: false,
      failure: { kind: "failed", message: "gh: HTTP 504" },
    });
    expect(ghCalls).toHaveLength(2);
  });
});
