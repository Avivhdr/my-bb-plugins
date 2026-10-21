import { describe, expect, it, vi } from "vitest";
import { createSourceReader, MAX_DOCUMENT_BYTES, type SourceAdapter } from "../source";

const target = {
  path: "reports/note.md",
  source: {
    kind: "workspace" as const,
    threadId: null,
    environmentId: "env",
    projectId: "project",
    experimental_hostId: "remote",
  },
};
function setup() {
  const adapter: SourceAdapter = {
    resolveHostRoot: vi.fn(async ({ rootPath }) => rootPath),
    environment: vi.fn(async () => ({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path: "/work/tree",
      status: "ready",
    })),
    project: vi.fn(async () => ({
      id: "project",
      sources: [{ hostId: "remote", path: "/project", isDefault: true }],
    })),
    thread: vi.fn(async () => ({ id: "thread", projectId: "project", environmentId: "env" })),
    storageLocation: vi.fn(async () => ({
      hostId: "remote",
      storageRootPath: "/data/thread-storage/thread",
    })),
    findByName: vi.fn(async () => []),
    read: vi.fn(async () => ({
      content: "# Exact\r\n",
      contentEncoding: "utf8" as const,
      sha256: "hash",
      sizeBytes: 9,
    })),
  };
  return { adapter, reader: createSourceReader(adapter) };
}

describe("workspace source interface", () => {
  it("reads the exact remote worktree with confinement and retains source identity", async () => {
    const { reader, adapter } = setup();
    const result = await reader.read(target);
    expect(result).toEqual({
      kind: "ready",
      snapshot: {
        text: "# Exact\r\n",
        sha256: "hash",
        sizeBytes: 9,
        target,
        hostId: "remote",
        rootPath: "/work/tree",
        documentPath: "/work/tree/reports/note.md",
        documentDirectory: "/work/tree/reports",
      },
    });
    expect(adapter.read).toHaveBeenCalledWith({
      hostId: "remote",
      rootPath: "/work/tree",
      path: "/work/tree/reports/note.md",
    });
    if (result.kind === "ready") expect(Object.isFrozen(result.snapshot)).toBe(true);
  });
  it("uses an explicit project host rather than the default on another host", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.project).mockResolvedValue({
      id: "project",
      sources: [
        { hostId: "server", path: "/wrong", isDefault: true },
        { hostId: "remote", path: "/right", isDefault: false },
      ],
    });
    await reader.read({ ...target, source: { ...target.source, environmentId: null } });
    expect(adapter.read).toHaveBeenCalledWith({
      hostId: "remote",
      rootPath: "/right",
      path: "/right/reports/note.md",
    });
  });
  it("resolves thread-only workspace identity from the thread's environment", async () => {
    const { reader, adapter } = setup();
    const result = await reader.read({
      ...target,
      source: { kind: "workspace", threadId: "thread", environmentId: null, projectId: null },
    });
    expect(result.kind).toBe("ready");
    expect(adapter.environment).toHaveBeenCalledWith("env");
  });
  it.each(["../escape.md", "/absolute.md", "a\\b.md", "%2e%2e/escape.md", "note.txt", "note.mdx"])(
    "rejects invalid target %s before a file read",
    async (path) => {
      const { reader, adapter } = setup();
      expect((await reader.read({ ...target, path })).kind).toBe("unsupported");
      expect(adapter.read).not.toHaveBeenCalled();
    },
  );
  it("rejects inconsistent host or project identity", async () => {
    const { reader, adapter } = setup();
    expect(
      (
        await reader.read({
          ...target,
          source: { ...target.source, experimental_hostId: "server" },
        })
      ).kind,
    ).toBe("error");
    expect(
      (await reader.read({ ...target, source: { ...target.source, projectId: "other" } })).kind,
    ).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it("does not guess a root for missing, unready, or ambiguous workspace identity", async () => {
    const { reader, adapter } = setup();
    expect(
      (
        await reader.read({
          ...target,
          source: { kind: "workspace", threadId: null, environmentId: null, projectId: null },
        })
      ).kind,
    ).toBe("error");
    vi.mocked(adapter.environment).mockResolvedValue({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path: null,
      status: "creating",
    });
    expect((await reader.read(target)).kind).toBe("error");
    vi.mocked(adapter.project).mockResolvedValue({
      id: "project",
      sources: [
        { hostId: "remote", path: "/one", isDefault: false },
        { hostId: "remote", path: "/two", isDefault: false },
      ],
    });
    expect(
      (await reader.read({ ...target, source: { ...target.source, environmentId: null } })).kind,
    ).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it("reports a disconnected or missing file without substituting a local read", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.read).mockRejectedValue(new Error("Host disconnected"));
    expect(await reader.read(target)).toEqual({ kind: "error", message: "Host disconnected" });
    expect(adapter.read).toHaveBeenCalledTimes(1);
  });
  it("accepts empty and exactly 1 MiB UTF-8 text, rejects larger or non-text data", async () => {
    const { reader, adapter } = setup();
    for (const text of ["", "x".repeat(MAX_DOCUMENT_BYTES)]) {
      vi.mocked(adapter.read).mockResolvedValue({
        content: text,
        contentEncoding: "utf8",
        sha256: "hash",
        sizeBytes: text.length,
      });
      expect((await reader.read(target)).kind).toBe("ready");
    }
    for (const file of [
      { content: "ignored", contentEncoding: "utf8" as const, sizeBytes: MAX_DOCUMENT_BYTES + 1 },
      {
        content: "x".repeat(MAX_DOCUMENT_BYTES + 1),
        contentEncoding: "utf8" as const,
        sizeBytes: 1,
      },
      { content: "AA==", contentEncoding: "base64" as const, sizeBytes: 1 },
      { content: "a\0b", contentEncoding: "utf8" as const, sizeBytes: 3 },
    ]) {
      vi.mocked(adapter.read).mockResolvedValue({ ...file, sha256: "hash" });
      expect((await reader.read(target)).kind).toBe("unsupported");
    }
  });
  it("rejects malformed RPC input at the public read boundary", async () => {
    const { reader, adapter } = setup();
    expect((await reader.read({ path: target.path, source: { kind: "workspace" } })).kind).toBe(
      "unsupported",
    );
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it("retains host confinement when the SDK rejects a symlink escape", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.read).mockRejectedValue(new Error("Resolved path is outside rootPath"));
    expect(await reader.read(target)).toEqual({
      kind: "error",
      message: "Resolved path is outside rootPath",
    });
    expect(adapter.read).toHaveBeenCalledTimes(1);
  });
  it("uses host path semantics for a Windows workspace, not the server OS", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.environment).mockResolvedValue({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path: "C:\\work\\tree",
      status: "ready",
    });
    expect((await reader.read(target)).kind).toBe("ready");
    expect(adapter.read).toHaveBeenCalledWith({
      hostId: "remote",
      rootPath: "C:\\work\\tree",
      path: "C:\\work\\tree\\reports\\note.md",
    });
  });
  it("counts multibyte UTF-8 content rather than source characters", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.read).mockResolvedValue({
      content: "é".repeat(MAX_DOCUMENT_BYTES / 2 + 1),
      contentEncoding: "utf8",
      sha256: "hash",
      sizeBytes: 1,
    });
    expect((await reader.read(target)).kind).toBe("unsupported");
  });
});
