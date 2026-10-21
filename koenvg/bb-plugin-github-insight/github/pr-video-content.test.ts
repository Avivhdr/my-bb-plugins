import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  calls: [] as unknown[][],
  size: "24",
  bytes: Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex"),
  error: null as object | null,
}));
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return {
    execFile: Object.assign(() => {}, {
      [promisify.custom]: (...args: unknown[]) => {
        state.calls.push(args);
        const options = args[2] as { encoding?: string };
        return state.error
          ? Promise.reject(state.error)
          : Promise.resolve({ stdout: options.encoding === "buffer" ? state.bytes : state.size });
      },
    }),
  };
});
const { default: host } = await import("../host");
const request = {
  owner: "private-owner",
  repo: "private-fork",
  sha: "1111111111111111111111111111111111111111",
  path: "videos/a b#?.mp4",
};
beforeEach(() => {
  state.calls = [];
  state.size = "24";
  state.error = null;
});
describe("authenticated bounded video host", () => {
  it("checks size before reading raw bytes at an encoded immutable revision", async () => {
    const signal = new AbortController().signal;
    expect(await host.handlers.readPrVideo(request, { signal } as never)).toMatchObject({
      kind: "ready",
      mime: "video/mp4",
      sizeBytes: 24,
    });
    expect(state.calls).toEqual([
      [
        "gh",
        [
          "api",
          "repos/private-owner/private-fork/contents/videos/a%20b%23%3F.mp4?ref=1111111111111111111111111111111111111111",
          "-H",
          "Accept: application/vnd.github.object+json",
          "--jq",
          ".size",
        ],
        { signal, maxBuffer: 4096, timeout: 20_000 },
      ],
      [
        "gh",
        [
          "api",
          "repos/private-owner/private-fork/contents/videos/a%20b%23%3F.mp4?ref=1111111111111111111111111111111111111111",
          "-H",
          "Accept: application/vnd.github.raw+json",
        ],
        { signal, encoding: "buffer", maxBuffer: 8388608, timeout: 20_000 },
      ],
    ]);
  });
  it.each(["8388609", "-1", "unknown", "0"])(
    "does not read raw bytes after invalid or oversized size %s",
    async (size) => {
      state.size = size;
      expect(
        await host.handlers.readPrVideo(request, { signal: new AbortController().signal } as never),
      ).toMatchObject({ kind: "error", code: size === "8388609" ? "too_large" : "read" });
      expect(state.calls).toHaveLength(1);
    },
  );
  it("rejects unsafe input before spawning gh and rejects partial content", async () => {
    expect(
      await host.handlers.readPrVideo({ ...request, path: "../secret.mp4" }, {
        signal: new AbortController().signal,
      } as never),
    ).toMatchObject({ kind: "error", code: "read" });
    expect(state.calls).toHaveLength(0);
    state.size = "25";
    expect(
      await host.handlers.readPrVideo(request, { signal: new AbortController().signal } as never),
    ).toMatchObject({ kind: "error", code: "read" });
  });
  it.each([
    [{ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", stdout: "partial" }, "too_large"],
    [{ stderr: "secret token HTTP 403" }, "auth"],
    [{ stderr: "secret token HTTP 404" }, "missing"],
    [{ code: "ABORT_ERR" }, "read"],
  ])(
    "sanitizes host failures without leaking partial bytes or credentials",
    async (error, code) => {
      state.error = error;
      const result = await host.handlers.readPrVideo(request, {
        signal: new AbortController().signal,
      } as never);
      expect(result).toMatchObject({ kind: "error", code });
      expect(JSON.stringify(result)).not.toMatch(/secret|partial/);
    },
  );
});
