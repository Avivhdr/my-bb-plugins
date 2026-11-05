import { describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  calls: [] as unknown[][],
  bytes: Buffer.from("89504e470d0a1a0a00000000", "hex"),
  error: null as object | null,
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(() => {}, {
      [promisify.custom]: (...args: unknown[]) => {
        state.calls.push(args);
        return Object.assign(
          state.error ? Promise.reject(state.error) : Promise.resolve({ stdout: state.bytes }),
          { child: { stdin: { end: () => undefined } } },
        );
      },
    }),
  };
});
const { default: host } = await import("../host");
const request = {
  owner: "private-owner",
  repo: "private-repo",
  sha: "1111111111111111111111111111111111111111",
  path: "images/a b#?.png",
};
describe("authenticated bounded image host", () => {
  it("reads encoded content at a literal immutable ref with binary output and cancellation", async () => {
    state.calls = [];
    state.error = null;
    const signal = new AbortController().signal;
    expect(await host.handlers.readPrImage(request, { signal } as never)).toEqual({
      kind: "ready",
      content: "iVBORw0KGgoAAAAA",
      mime: "image/png",
      sizeBytes: 12,
    });
    expect(state.calls).toEqual([
      [
        "gh",
        [
          "api",
          "repos/private-owner/private-repo/contents/images/a%20b%23%3F.png?ref=1111111111111111111111111111111111111111",
          "-H",
          "Accept: application/vnd.github.raw",
        ],
        { signal, encoding: "buffer", maxBuffer: 4194304, timeout: 20000 },
      ],
    ]);
  });
  it("reads a linked repo image at a branch ref the same way", async () => {
    state.calls = [];
    state.error = null;
    const signal = new AbortController().signal;
    const linked = { owner: "acme", repo: "api", ref: "main", path: "docs/shot.png" };
    expect(await host.handlers.readRepoImage(linked, { signal } as never)).toMatchObject({
      kind: "ready",
      mime: "image/png",
    });
    expect(state.calls[0]![1]).toEqual([
      "api",
      "repos/acme/api/contents/docs/shot.png?ref=main",
      "-H",
      "Accept: application/vnd.github.raw",
    ]);
  });
  it("says a linked repo image is missing on a 404", async () => {
    state.calls = [];
    state.error = { stderr: "gh: Not Found (HTTP 404)" };
    const linked = { owner: "acme", repo: "api", ref: "main", path: "gone.png" };
    expect(
      await host.handlers.readRepoImage(linked, { signal: new AbortController().signal } as never),
    ).toMatchObject({ kind: "error", code: "missing" });
    state.error = null;
  });
  it("rejects repository and path traversal before starting gh", async () => {
    state.calls = [];
    state.error = null;
    for (const input of [
      { ...request, repo: ".." },
      { ...request, path: "../secret.png" },
    ]) {
      expect(
        await host.handlers.readPrImage(input, { signal: new AbortController().signal } as never),
      ).toMatchObject({ kind: "error", code: "read" });
    }
    expect(state.calls).toEqual([]);
  });
  it("compares pinned fork refs through authenticated gh in the base repository", async () => {
    state.calls = [];
    state.error = null;
    state.bytes = Buffer.from(
      JSON.stringify({ merge_base_commit: { sha: "3333333333333333333333333333333333333333" } }),
    );
    const signal = new AbortController().signal;
    expect(
      await host.handlers.fetchImageMergeBase(
        {
          baseRepo: { owner: "base-owner", repo: "private-repo" },
          headRepo: { owner: "fork-owner", repo: "renamed-fork" },
          baseSha: "1111111111111111111111111111111111111111",
          headSha: "2222222222222222222222222222222222222222",
        },
        { signal } as never,
      ),
    ).toEqual({
      ok: true,
      data: { merge_base_commit: { sha: "3333333333333333333333333333333333333333" } },
    });
    expect(state.calls[0]?.slice(0, 2)).toEqual([
      "gh",
      [
        "api",
        "repos/base-owner/private-repo/compare/1111111111111111111111111111111111111111...fork-owner%3A2222222222222222222222222222222222222222",
      ],
    ]);
  });
  it.each([
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "partial" }, "too_large"],
    [{ stderr: "secret token HTTP 403", stdout: "partial" }, "auth"],
    [{ stderr: "secret HTTP 404" }, "missing"],
    [{ code: "ABORT_ERR" }, "read"],
    [{ killed: true }, "read"],
  ])("returns sanitized failures without partial data", async (error, code) => {
    state.error = error;
    const result = await host.handlers.readPrImage(request, {
      signal: new AbortController().signal,
    } as never);
    expect(result).toMatchObject({ kind: "error", code });
    expect(JSON.stringify(result)).not.toMatch(/secret|partial|token/);
  });
});
