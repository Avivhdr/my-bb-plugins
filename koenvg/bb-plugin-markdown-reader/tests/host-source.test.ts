// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  realpath,
  lstat,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../host";
import plugin from "../server";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose();
});

async function setup() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "markdown-reader-root-")));
  disposers.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "real");
  const alias = join(directory, "alias");
  await mkdir(root);
  await symlink(root, alias, "dir");
  await writeFile(join(root, "note.md"), "# Report\n");
  const host = experimental_createHostEntryHarness(hostEntry);
  disposers.push(() => host.experimental_dispose());
  // Model the SDK's root and resolved-file confinement policy, not its transport.
  const read = vi.fn(async ({ rootPath, path }: { rootPath?: string; path: string }) => {
    if (!rootPath) throw new Error("A confined root is required.");
    if ((await lstat(rootPath)).isSymbolicLink()) throw new Error("Root must not be a symlink");
    const filePath = await realpath(path);
    const tail = relative(rootPath, filePath);
    if (tail === ".." || tail.startsWith("../") || isAbsolute(tail))
      throw new Error("File escapes read root");
    const content = await readFile(filePath, "utf8");
    return {
      content,
      contentEncoding: "utf8",
      sha256: "hash",
      sizeBytes: Buffer.byteLength(content),
    };
  });
  const { bb, harness } = createFakePluginHost({
    pluginId: "markdown-reader",
    experimental_callHostRpc: async ({ method, input, hostId }) => {
      expect(hostId).toBe("selected-host");
      expect(method).toBe("resolve_root");
      return host.experimental_call("resolve_root", input as { rootPath: string });
    },
    sdk: { files: { read } },
  });
  disposers.push(() => harness.lifecycle.dispose());
  plugin(bb);
  const target = {
    path: join(alias, "note.md"),
    source: {
      kind: "host",
      threadId: null,
      environmentId: null,
      projectId: null,
      experimental_hostId: "selected-host",
    },
  };
  return { directory, root, alias, host, harness, target, read };
}

describe("host directory aliases", () => {
  it("resolves the system temporary directory on this host", async () => {
    const { host } = await setup();
    expect(await host.experimental_call("resolve_root", { rootPath: tmpdir() })).toEqual({
      rootPath: await realpath(tmpdir()),
    });
  });

  it("reads through an alias and uses the same real root for sibling links and images", async () => {
    const { root, harness, target, read } = await setup();
    await writeFile(join(root, "figure.png"), "image bytes");
    expect(await harness.behavior.callRpc("read_document", target)).toMatchObject({
      kind: "ready",
      snapshot: { text: "# Report\n", target, rootPath: root, documentPath: join(root, "note.md") },
    });
    expect(read).toHaveBeenCalledExactlyOnceWith({
      hostId: "selected-host",
      rootPath: root,
      path: join(root, "note.md"),
    });
    const result = (await harness.behavior.callRpc("resolve_destinations", {
      target,
      requests: [
        { url: "sibling.md", image: false },
        { url: "figure.png", image: true },
        { url: "../outside.md", image: false },
      ],
    })) as { identity: unknown; destinations: { kind: string; url?: string }[] };
    expect(result).toMatchObject({
      identity: { hostId: "selected-host", rootPath: root, documentPath: join(root, "note.md") },
      destinations: [
        { kind: "local-file", target: { kind: "host", path: join(root, "sibling.md") } },
        { kind: "image", remote: false },
        { kind: "rejected" },
      ],
    });
    const query = new URL(result.destinations[1]!.url!, "http://plugin.test").search;
    const image = await harness.behavior.fetchHttp("GET", `/image${query}`);
    expect(image.status).toBe(200);
    expect(await image.text()).toBe("image bytes");
    expect(read).toHaveBeenNthCalledWith(2, {
      hostId: "selected-host",
      rootPath: root,
      path: join(root, "figure.png"),
    });
    expect(harness.inspection.sdk.callsTo("files.createPreview")).toHaveLength(0);
    expect(harness.inspection.sdk.calls.every((call) => call.path === "files.read")).toBe(true);
  });

  it("does not resolve the document itself to permit an outside-root file symlink", async () => {
    const { directory, root, alias, harness, target } = await setup();
    await writeFile(join(directory, "outside.md"), "# Private");
    await symlink(join(directory, "outside.md"), join(root, "escape.md"));
    expect(
      await harness.behavior.callRpc("read_document", {
        ...target,
        path: join(alias, "escape.md"),
      }),
    ).toMatchObject({ kind: "error", message: "File escapes read root" });
  });

  it("reports a missing directory without an unconfined read or host fallback", async () => {
    const { directory, harness, target, read } = await setup();
    expect(
      await harness.behavior.callRpc("read_document", {
        ...target,
        path: join(directory, "missing", "note.md"),
      }),
    ).toMatchObject({ kind: "error" });
    expect(read).not.toHaveBeenCalled();
    expect(harness.inspection.sdk.calls).toEqual([]);
  });

  it("accepts a real directory and rejects relative host-worker roots", async () => {
    const { root, host } = await setup();
    expect(await host.experimental_call("resolve_root", { rootPath: root })).toEqual({
      rootPath: root,
    });
    await expect(host.experimental_call("resolve_root", { rootPath: "relative" })).rejects.toThrow(
      "must be absolute",
    );
  });

  it("finds files by name below a root, skipping dot and dependency directories", async () => {
    const { root, host } = await setup();
    await mkdir(join(root, "knowledge", "deep"), { recursive: true });
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await mkdir(join(root, ".git"));
    await writeFile(join(root, "knowledge", "deep", "guide.md"), "");
    await writeFile(join(root, "node_modules", "pkg", "guide.md"), "");
    await writeFile(join(root, ".git", "guide.md"), "");
    expect(
      await host.experimental_call("find_by_name", { rootPath: root, name: "guide.md" }),
    ).toEqual({ paths: ["knowledge/deep/guide.md"] });
    await expect(
      host.experimental_call("find_by_name", { rootPath: "relative", name: "guide.md" }),
    ).rejects.toThrow("must be absolute");
  });
});
