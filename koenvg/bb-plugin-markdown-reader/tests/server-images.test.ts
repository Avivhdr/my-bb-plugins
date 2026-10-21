// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { destinationsResultSchema, type ReaderTarget } from "../source";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const dispose of disposers.splice(0)) await dispose();
});
const png = Buffer.from("89504e470d0a1a0a", "hex");

function setup() {
  let failure = false;
  const { bb, harness } = createFakePluginHost({
    pluginId: "markdown-reader",
    experimental_callHostRpc: async ({ input }) => input,
    sdk: {
      environments: {
        get: async () => ({
          id: "env",
          projectId: "project",
          hostId: "remote",
          path: "/work",
          status: "ready",
        }),
      },
      threads: {
        get: async () => ({ id: "thread", projectId: "project", environmentId: "env" }),
        storageLocation: async () => ({ hostId: "remote", storageRootPath: "/actual/storage" }),
      },
      files: {
        read: async () => {
          if (failure) throw new Error("Confined SDK read denied: /private/outside.png");
          return {
            content: png.toString("base64"),
            contentEncoding: "base64",
            sizeBytes: png.length,
            sha256: "hash",
          };
        },
      },
    },
  });
  disposers.push(() => harness.lifecycle.dispose());
  plugin(bb);
  const resolve = async (target: ReaderTarget, url = "picture.png") =>
    destinationsResultSchema.parse(
      await harness.behavior.callRpc("resolve_destinations", {
        target,
        requests: [{ url, image: true }],
      }),
    );
  const get = (url: string) => {
    const parsed = new URL(url, "http://plugin.test");
    return harness.behavior.fetchHttp("GET", `/image${parsed.search}`);
  };
  return {
    harness,
    resolve,
    get,
    fail: () => {
      failure = true;
    },
  };
}

const sources: { target: ReaderTarget; root: string; path: string }[] = [
  {
    target: {
      path: "reports/note.md",
      source: { kind: "workspace", threadId: null, environmentId: "env", projectId: null },
    },
    root: "/work",
    path: "/work/reports/picture.png",
  },
  {
    target: {
      path: "/notes/note.md",
      source: {
        kind: "host",
        threadId: null,
        environmentId: null,
        projectId: null,
        experimental_hostId: "remote",
      },
    },
    root: "/notes",
    path: "/notes/picture.png",
  },
  {
    target: {
      path: "reports/note.md",
      source: { kind: "thread-storage", threadId: "thread", environmentId: null, projectId: null },
    },
    root: "/actual/storage",
    path: "/actual/storage/reports/picture.png",
  },
];

describe("single-image HTTP transport", () => {
  it.each(sources)(
    "serves only the selected $target.source.kind image without expiry or a folder lease",
    async ({ target, root, path }) => {
      const { harness, resolve, get } = setup();
      const result = await resolve(target);
      const image = result.destinations[0]!;
      expect(image.kind).toBe("image");
      if (image.kind !== "image") throw new Error("Image missing");
      expect(image).not.toHaveProperty("expiresAtMs");
      expect(image.url).not.toMatch(/remote|\/work|\/notes|\/actual|picture\.png/);
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
      const first = await get(image.url);
      expect(first.status).toBe(200);
      expect(Buffer.from(await first.arrayBuffer())).toEqual(png);
      expect(first.headers.get("content-type")).toBe("image/png");
      expect(first.headers.get("cache-control")).toBe("no-store");
      expect(first.headers.get("x-content-type-options")).toBe("nosniff");
      expect(first.headers.get("content-security-policy")).toContain("sandbox");
      vi.useFakeTimers();
      vi.setSystemTime(Date.now() + 86400000);
      const later = await get(`${image.url}&path=../secret.md&rootPath=/`);
      expect(later.status).toBe(200);
      expect(Buffer.from(await later.arrayBuffer())).toEqual(png);
      expect(harness.inspection.sdk.callsTo("files.read")).toEqual([
        [{ hostId: "remote", rootPath: root, path }],
        [{ hostId: "remote", rootPath: root, path }],
      ]);
      expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
      expect(harness.inspection.registrations.httpRoutes).toMatchObject([
        { method: "GET", path: "/image", auth: "local" },
      ]);
    },
  );

  it("rejects modified, missing and plain-file tokens without any file read", async () => {
    const { harness, resolve, get } = setup();
    const image = (await resolve(sources[0]!.target)).destinations[0]!;
    if (image.kind !== "image") throw new Error("Image missing");
    const asset = new URL(image.url, "http://plugin.test").searchParams.get("asset")!;
    const modified = Buffer.from(asset, "base64url");
    modified[modified.length - 1] = modified[modified.length - 1]! ^ 1;
    for (const query of [
      "",
      "?asset=picture.png",
      "?asset=",
      `?asset=${modified.toString("base64url")}`,
    ]) {
      expect((await harness.behavior.fetchHttp("GET", `/image${query}`)).status).toBe(404);
    }
    expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
    await expect(get(`${image.url}/other.png`)).resolves.toMatchObject({ status: 404 });
  });

  it.each(["../outside.png", "active.svg", "file.pdf", "file.html"])(
    "does not issue access for %s",
    async (url) => {
      const { harness, resolve } = setup();
      expect((await resolve(sources[1]!.target, url)).destinations[0]?.kind).toBe("rejected");
      expect(harness.inspection.sdk.callsTo("files.read")).toHaveLength(0);
      expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
    },
  );

  it("retains host-side symlink confinement and reports a readable failure without exposing paths", async () => {
    const { harness, resolve, get, fail } = setup();
    const image = (await resolve(sources[0]!.target)).destinations[0]!;
    if (image.kind !== "image") throw new Error("Image missing");
    fail();
    const response = await get(image.url);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Image unavailable. Refresh to retry.");
    expect(harness.inspection.sdk.callsTo("files.read")).toEqual([
      [{ hostId: "remote", rootPath: "/work", path: "/work/reports/picture.png" }],
    ]);
  });

  it("invalidates old URLs on reload and gives Refresh a usable new URL", async () => {
    const { harness, resolve } = setup();
    const old = (await resolve(sources[0]!.target)).destinations[0]!;
    if (old.kind !== "image") throw new Error("Image missing");
    const replacement = await harness.lifecycle.reload(plugin);
    disposers.push(() => replacement.harness.lifecycle.dispose());
    const oldQuery = new URL(old.url, "http://plugin.test").search;
    expect((await replacement.harness.behavior.fetchHttp("GET", `/image${oldQuery}`)).status).toBe(
      404,
    );
    const fresh = destinationsResultSchema.parse(
      await replacement.harness.behavior.callRpc("resolve_destinations", {
        target: sources[0]!.target,
        requests: [{ url: "picture.png", image: true }],
      }),
    ).destinations[0]!;
    if (fresh.kind !== "image") throw new Error("Image missing");
    const freshQuery = new URL(fresh.url, "http://plugin.test").search;
    expect(
      (await replacement.harness.behavior.fetchHttp("GET", `/image${freshQuery}`)).status,
    ).toBe(200);
  });
});
