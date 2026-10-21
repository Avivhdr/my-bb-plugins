import { describe, expect, it, vi } from "vitest";
import { createSourceReader, type SourceAdapter, type ReaderTarget } from "../source";

const targets: ReaderTarget[] = [
  {
    path: "reports/note.md",
    source: { kind: "workspace", threadId: "thread", environmentId: null, projectId: null },
  },
  {
    path: "/notes/note.md",
    source: {
      kind: "host",
      threadId: null,
      environmentId: null,
      projectId: null,
      experimental_hostId: "remote",
    },
  },
  {
    path: "reports/note.md",
    source: { kind: "thread-storage", threadId: "thread", environmentId: null, projectId: null },
  },
];
function setup() {
  let images = 0;
  const adapter: SourceAdapter = {
    resolveHostRoot: vi.fn(async ({ rootPath }) => rootPath),
    environment: vi.fn(async () => ({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path: "/work",
      status: "ready",
    })),
    project: vi.fn(async () => ({
      id: "project",
      sources: [{ hostId: "remote", path: "/work", isDefault: true }],
    })),
    thread: vi.fn(async () => ({ id: "thread", projectId: "project", environmentId: "env" })),
    storageLocation: vi.fn(async () => ({ hostId: "remote", storageRootPath: "/actual/storage" })),
    findByName: vi.fn(async () => []),
    read: vi.fn(async () => ({
      content: "# Note",
      contentEncoding: "utf8" as const,
      sha256: "hash",
      sizeBytes: 6,
    })),
    imageUrl: vi.fn(
      async () => `/api/v1/plugins/markdown-reader/http/image?asset=image${++images}`,
    ),
  };
  return { adapter, reader: createSourceReader(adapter) };
}
const request = (url: string, image = false) => ({ url, image });

describe("source destination interface", () => {
  it.each(targets)(
    "resolves siblings from $source.kind without reads or previews and retains its actual identity",
    async (target) => {
      const { reader, adapter } = setup();
      const result = await reader.destinations({
        target,
        requests: [
          request("sibling%20file.md"),
          request("./note.md#note"),
          request("#note"),
          request("https://example.com/a?q=1#x"),
        ],
      });
      const expected =
        target.source.kind === "workspace"
          ? { kind: "workspace", environmentId: "env", path: "reports/sibling file.md" }
          : target.source.kind === "host"
            ? { kind: "host", hostId: "remote", path: "/notes/sibling file.md" }
            : { kind: "thread-storage", threadId: "thread", path: "reports/sibling file.md" };
      expect(result.destinations).toEqual([
        { kind: "local-file", target: expected, hostId: "remote" },
        { kind: "fragment", fragment: "#note" },
        { kind: "fragment", fragment: "#note" },
        { kind: "external-url", url: "https://example.com/a?q=1#x" },
      ]);
      expect(adapter.read).not.toHaveBeenCalled();
      expect(adapter.imageUrl).not.toHaveBeenCalled();
    },
  );
  it.each([targets[0]!, targets[2]!])(
    "permits literal parent links inside the $source.kind root",
    async (target) => {
      const { reader } = setup();
      expect(
        (await reader.destinations({ target, requests: [request("../parent.md")] }))
          .destinations[0],
      ).toMatchObject({
        kind: "local-file",
        target: { kind: target.source.kind, path: "parent.md" },
        hostId: "remote",
      });
    },
  );
  it.each([
    "javascript:alert(1)",
    "data:image/svg+xml,bad",
    "file:///etc/passwd",
    "mailto:x@y.z",
    "//evil.test/a",
    "https:/broken",
    "https://",
    "https:///evil.test/image.png",
    "http:////evil.test/a",
    "https://example.com/%2e%2e/a",
    "https://example.com/%252e%252e/a",
    "https://user:pass@example.com/x",
    "https://example.com/%zz",
    "%zz",
    "%2e%2e/x.md",
    ".%2e/x.md",
    "%252e%252e/x.md",
    "a%2fb.md",
    "a%5cb.md",
    "../../escape.md",
    "/etc/passwd",
    "C:/outside.png",
    "a\\b.png",
    "x%00.png",
    "x%0a.png",
    "x\ud800.png",
  ])("rejects %s before any content or transport effect", async (url) => {
    const { reader, adapter } = setup();
    const result = await reader.destinations({
      target: targets[0],
      requests: [request(url), request(url, true)],
    });
    expect(result.destinations.every((d) => d.kind === "rejected")).toBe(true);
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.imageUrl).not.toHaveBeenCalled();
  });
  it("does not expand an absolute-host containing-directory root", async () => {
    const { reader, adapter } = setup();
    expect(
      (
        await reader.destinations({
          target: targets[1],
          requests: [request("../parent.md"), request("../parent.png", true)],
        })
      ).destinations.every((d) => d.kind === "rejected"),
    ).toBe(true);
    expect(adapter.imageUrl).not.toHaveBeenCalled();
  });
  it.each(targets)(
    "uses image-only URLs for supported $source.kind images with no leaked identities",
    async (target) => {
      const { reader, adapter } = setup();
      const result = await reader.destinations({
        target,
        requests: [
          request("picture%20one.png", true),
          request("./picture%20one.png", true),
          request("photo.jpg", true),
          request("https://images.test/a.webp", true),
        ],
      });
      const rootPath =
        target.source.kind === "workspace"
          ? "/work"
          : target.source.kind === "host"
            ? "/notes"
            : "/actual/storage";
      expect(adapter.imageUrl).toHaveBeenNthCalledWith(1, {
        hostId: "remote",
        rootPath,
        path: `${rootPath}/${target.source.kind === "host" ? "" : "reports/"}picture one.png`,
      });
      expect(adapter.imageUrl).toHaveBeenCalledTimes(2);
      expect(result.destinations[0]).toMatchObject({
        kind: "image",
        url: "/api/v1/plugins/markdown-reader/http/image?asset=image1",
        remote: false,
      });
      expect(result.destinations[1]).toEqual(result.destinations[0]);
      expect(result.destinations[3]).toEqual({
        kind: "image",
        url: "https://images.test/a.webp",
        remote: true,
      });
      expect(adapter.read).not.toHaveBeenCalled();
    },
  );
  it.each(["active.svg", "page.html", "file.pdf", "image.tiff", "data:image/png;base64,AA=="])(
    "keeps unsafe/unsupported image %s readable without transport",
    async (url) => {
      const { reader, adapter } = setup();
      expect(
        (await reader.destinations({ target: targets[0], requests: [request(url, true)] }))
          .destinations[0],
      ).toMatchObject({ kind: "rejected" });
      expect(adapter.imageUrl).not.toHaveBeenCalled();
    },
  );
  it("keeps valid file/URL results when image URL creation fails", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.imageUrl!).mockRejectedValue(new Error("Host disconnected"));
    const result = await reader.destinations({
      target: targets[0],
      requests: [request("image.png", true), request("next.md"), request("https://example.com")],
    });
    expect(result.destinations.map((d) => d.kind)).toEqual([
      "rejected",
      "local-file",
      "external-url",
    ]);
    expect(result.destinations[0]).toMatchObject({
      reason: "Image preview is unavailable. Refresh to retry.",
    });
  });
  it("rejects caller-supplied roots, invalid source identities and oversized batches", async () => {
    const { reader, adapter } = setup();
    await expect(
      reader.destinations({
        target: targets[0],
        rootPath: "/",
        requests: [request("x.png", true)],
      }),
    ).rejects.toThrow();
    await expect(
      reader.destinations({
        target: targets[0],
        requests: Array.from({ length: 129 }, () => request("x.png", true)),
      }),
    ).rejects.toThrow();
    const bad = { ...targets[0]!, source: { ...targets[0]!.source, experimental_hostId: "wrong" } };
    expect(
      (await reader.destinations({ target: bad, requests: [request("x.png", true)] }))
        .destinations[0],
    ).toMatchObject({ kind: "rejected" });
    expect(adapter.imageUrl).not.toHaveBeenCalled();
  });
  it("bounds image destinations at 32 and creates fresh URLs on each snapshot request", async () => {
    const { reader, adapter } = setup();
    const requests = Array.from({ length: 33 }, (_, i) => request(`${i}.png`, true));
    const result = await reader.destinations({ target: targets[0], requests });
    expect(result.destinations.filter((d) => d.kind === "image")).toHaveLength(32);
    expect(result.destinations[32]).toMatchObject({ kind: "rejected" });
    await reader.destinations({ target: targets[0], requests: [request("0.png", true)] });
    expect(adapter.imageUrl).toHaveBeenCalledTimes(33);
  });
  it.each([
    "https://evil.test/x",
    "/api/v1/file-previews/token",
    "/api/v1/plugins/markdown-reader/http/image?asset=x&path=other.png",
  ])("rejects invalid image URL %j", async (url) => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.imageUrl!).mockResolvedValue(url);
    expect(
      (await reader.destinations({ target: targets[0], requests: [request("x.png", true)] }))
        .destinations[0],
    ).toMatchObject({ kind: "rejected" });
  });
  it("keeps Windows roots confined and uses public workspace identities", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.environment).mockResolvedValue({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path: "C:\\work",
      status: "ready",
    });
    const result = await reader.destinations({
      target: targets[0],
      requests: [
        request("../ok.md"),
        request("../../escape.png", true),
        request("picture.png", true),
      ],
    });
    expect(result.destinations[0]).toMatchObject({
      kind: "local-file",
      target: { kind: "workspace", path: "ok.md" },
    });
    expect(result.destinations[1]).toMatchObject({ kind: "rejected" });
    expect(adapter.imageUrl).toHaveBeenCalledExactlyOnceWith({
      hostId: "remote",
      rootPath: "C:\\work",
      path: "C:\\work\\reports\\picture.png",
    });
  });
  it("keeps project-only workspace links inert without guessing an environment, while images retain the project host/root", async () => {
    const { reader, adapter } = setup();
    const target: ReaderTarget = {
      path: "reports/note.md",
      source: { kind: "workspace", projectId: "project", threadId: null, environmentId: null },
    };
    const result = await reader.destinations({
      target,
      requests: [request("next.md"), request("photo.png", true)],
    });
    expect(result.destinations[0]).toMatchObject({ kind: "rejected" });
    expect(result.destinations[1]).toMatchObject({ kind: "image" });
    expect(adapter.imageUrl).toHaveBeenCalledExactlyOnceWith({
      hostId: "remote",
      rootPath: "/work",
      path: "/work/reports/photo.png",
    });
  });
  it.each([
    "https://images.test/%2e%2e%2fpicture.png",
    "https://images.test/a%2f..%2fpicture.png",
    "https://example.com/a%2f%2e%2e/guide",
  ])("rejects encoded separator traversal %s for links and images before effects", async (url) => {
    const { reader, adapter } = setup();
    expect(
      (
        await reader.destinations({
          target: targets[0],
          requests: [request(url), request(url, true)],
        })
      ).destinations.every((d) => d.kind === "rejected"),
    ).toBe(true);
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.imageUrl).not.toHaveBeenCalled();
  });
  it("accepts a 4096-character external URL at the wire bound and rejects a longer direct RPC request without effects", async () => {
    const { reader, adapter } = setup();
    const prefix = "https://example.com/";
    const url = prefix + "a".repeat(4096 - prefix.length);
    expect(
      (await reader.destinations({ target: targets[0], requests: [request(url)] })).destinations[0],
    ).toMatchObject({ kind: "external-url", url });
    await expect(
      reader.destinations({ target: targets[0], requests: [request(url + "a")] }),
    ).rejects.toThrow();
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.imageUrl).not.toHaveBeenCalled();
  });
});
