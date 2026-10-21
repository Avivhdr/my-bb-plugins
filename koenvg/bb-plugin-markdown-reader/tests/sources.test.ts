import { describe, expect, it, vi } from "vitest";
import { createSourceReader, type ReaderTarget, type SourceAdapter } from "../source";

const targets: ReaderTarget[] = [
  {
    path: "reports/note.md",
    source: { kind: "workspace", threadId: "thread", environmentId: null, projectId: null },
  },
  {
    path: "/notes/note.md",
    source: { kind: "host", threadId: "thread", environmentId: null, projectId: null },
  },
  {
    path: "reports/note.md",
    source: { kind: "thread-storage", threadId: "thread", environmentId: null, projectId: null },
  },
];
function setup() {
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
      sources: [{ hostId: "server", path: "/wrong", isDefault: true }],
    })),
    thread: vi.fn(async () => ({ id: "thread", projectId: "project", environmentId: "env" })),
    storageLocation: vi.fn(async () => ({
      hostId: "remote",
      storageRootPath: "/host-data/thread-storage/thread",
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

describe("all live source identities", () => {
  it.each(targets)(
    "routes $source.kind to the explicit remote host and confined root",
    async (target) => {
      const { reader, adapter } = setup();
      const result = await reader.read(target);
      const rootPath =
        target.source.kind === "workspace"
          ? "/work"
          : target.source.kind === "host"
            ? "/notes"
            : "/host-data/thread-storage/thread";
      const path = target.source.kind === "host" ? target.path : `${rootPath}/${target.path}`;
      expect(result).toMatchObject({
        kind: "ready",
        snapshot: { text: "# Exact\r\n", target, hostId: "remote", rootPath, documentPath: path },
      });
      expect(adapter.read).toHaveBeenCalledExactlyOnceWith({ hostId: "remote", rootPath, path });
      expect(adapter.project).not.toHaveBeenCalled();
      if (result.kind === "ready") {
        expect(Object.isFrozen(result.snapshot)).toBe(true);
        expect(Object.isFrozen(result.snapshot.target.source)).toBe(true);
      }
    },
  );
  it("uses an explicit host-only opener without guessing a thread or environment", async () => {
    const { reader, adapter } = setup();
    const target = {
      path: "/notes/note.md",
      source: {
        kind: "host",
        threadId: null,
        environmentId: null,
        projectId: null,
        experimental_hostId: "remote",
      },
    };
    expect((await reader.read(target)).kind).toBe("ready");
    expect(adapter.read).toHaveBeenCalledExactlyOnceWith({
      hostId: "remote",
      rootPath: "/notes",
      path: "/notes/note.md",
    });
    expect(adapter.thread).not.toHaveBeenCalled();
    expect(adapter.environment).not.toHaveBeenCalled();
  });
  it("uses host environment identity without requiring a ready workspace root", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.environment).mockResolvedValue({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path: null,
      status: "archived",
    });
    expect(
      (
        await reader.read({
          ...targets[1],
          source: { kind: "host", threadId: null, environmentId: "env", projectId: "project" },
        })
      ).kind,
    ).toBe("ready");
    expect(adapter.read).toHaveBeenCalledWith({
      hostId: "remote",
      rootPath: "/notes",
      path: "/notes/note.md",
    });
  });
  it("resolves storage from the named thread, not a constructed path or workspace root", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.thread).mockResolvedValue({
      id: "other-thread",
      projectId: "project",
      environmentId: null,
    });
    vi.mocked(adapter.storageLocation).mockResolvedValue({
      hostId: "storage-remote",
      storageRootPath: "/actual/storage/root",
    });
    expect(
      (
        await reader.read({
          ...targets[2],
          source: {
            kind: "thread-storage",
            threadId: "other-thread",
            environmentId: null,
            projectId: null,
          },
        })
      ).kind,
    ).toBe("ready");
    expect(adapter.storageLocation).toHaveBeenCalledExactlyOnceWith("other-thread");
    expect(adapter.environment).not.toHaveBeenCalled();
    expect(adapter.read).toHaveBeenCalledWith({
      hostId: "storage-remote",
      rootPath: "/actual/storage/root",
      path: "/actual/storage/root/reports/note.md",
    });
  });
  it.each(["host", "thread-storage"] as const)(
    "rejects missing %s identity with no read",
    async (kind) => {
      const { reader, adapter } = setup();
      expect(
        (
          await reader.read({
            path: kind === "host" ? "/notes/note.md" : "note.md",
            source: { kind, threadId: null, environmentId: null, projectId: "project" },
          })
        ).kind,
      ).toBe("error");
      expect(adapter.read).not.toHaveBeenCalled();
      expect(adapter.project).not.toHaveBeenCalled();
    },
  );
  it("does not use a project default when a host thread has no environment", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.thread).mockResolvedValue({
      id: "thread",
      projectId: "project",
      environmentId: null,
    });
    expect((await reader.read(targets[1])).kind).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
    expect(adapter.project).not.toHaveBeenCalled();
  });
  it.each(targets)(
    "rejects mismatched $source.kind thread/project/environment/host identities",
    async (target) => {
      for (const patch of [
        { projectId: "wrong" },
        { environmentId: "wrong" },
        { experimental_hostId: "wrong" },
      ]) {
        const { reader, adapter } = setup();
        expect(
          (await reader.read({ ...target, source: { ...target.source, ...patch } })).kind,
        ).toBe("error");
        expect(adapter.read).not.toHaveBeenCalled();
      }
      const { reader, adapter } = setup();
      vi.mocked(adapter.thread).mockResolvedValue({
        id: "wrong",
        projectId: "project",
        environmentId: "env",
      });
      expect((await reader.read(target)).kind).toBe("error");
      expect(adapter.read).not.toHaveBeenCalled();
    },
  );
  it.each(targets)(
    "propagates $source.kind missing/access/disconnection and symlink confinement errors without another read",
    async (target) => {
      for (const message of [
        "File missing",
        "Access denied",
        "Host disconnected",
        "Resolved path is outside rootPath",
      ]) {
        const { reader, adapter } = setup();
        vi.mocked(adapter.read).mockRejectedValue(new Error(message));
        expect(await reader.read(target)).toEqual({ kind: "error", message });
        expect(adapter.read).toHaveBeenCalledTimes(1);
        expect(vi.mocked(adapter.read).mock.calls[0]![0].hostId).toBe("remote");
        expect(vi.mocked(adapter.read).mock.calls[0]![0].rootPath).toBeTruthy();
      }
    },
  );
  it.each(["", "relative/root"])(
    "rejects an invalid actual storage root '%s'",
    async (storageRootPath) => {
      const { reader, adapter } = setup();
      vi.mocked(adapter.storageLocation).mockResolvedValue({ hostId: "remote", storageRootPath });
      expect((await reader.read(targets[2])).kind).toBe("error");
      expect(adapter.read).not.toHaveBeenCalled();
    },
  );
  it.each(["", "relative/root"])("rejects an invalid workspace root '%s'", async (path) => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.environment).mockResolvedValue({
      id: "env",
      projectId: "project",
      hostId: "remote",
      path,
      status: "ready",
    });
    expect((await reader.read(targets[0])).kind).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it.each(targets)("rejects missing resolved $source.kind host identity", async (target) => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.environment).mockResolvedValue({
      id: "env",
      projectId: "project",
      hostId: "",
      path: "/work",
      status: "ready",
    });
    vi.mocked(adapter.storageLocation).mockResolvedValue({
      hostId: "",
      storageRootPath: "/storage",
    });
    expect((await reader.read(target)).kind).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it.each([
    "note.md",
    "../note.md",
    "/notes/../note.md",
    "/notes/%2e%2e/note.md",
    "/notes/note.mdx",
    "/notes/note.md\0",
    "C:note.md",
    "\\\\?\\C:\\notes\\note.md",
  ])("rejects unsafe or non-absolute host path %s", async (path) => {
    const { reader, adapter } = setup();
    expect((await reader.read({ ...targets[1], path })).kind).toBe("unsupported");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it.each(["/note.md", "../note.md", "a/../../note.md", "%2e%2e/note.md", "a\\note.md"])(
    "rejects storage traversal %s",
    async (path) => {
      const { reader, adapter } = setup();
      expect((await reader.read({ ...targets[2], path })).kind).toBe("unsupported");
      expect(adapter.read).not.toHaveBeenCalled();
    },
  );
  it.each(["C:\\notes\\note.md", "C:/notes/note.md", "\\\\machine\\share\\notes\\note.md"])(
    "confines a Windows host path %s with host path semantics",
    async (path) => {
      const { reader, adapter } = setup();
      const result = await reader.read({ ...targets[1], path });
      expect(result.kind).toBe("ready");
      const normalized = path.replaceAll("/", "\\");
      expect(adapter.read).toHaveBeenCalledWith({
        hostId: "remote",
        rootPath: normalized.slice(0, normalized.lastIndexOf("\\")),
        path: normalized,
      });
    },
  );
  it("uses Windows storage root semantics on the remote host", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.storageLocation).mockResolvedValue({
      hostId: "remote",
      storageRootPath: "C:\\data\\thread-storage\\thread",
    });
    expect((await reader.read(targets[2])).kind).toBe("ready");
    expect(adapter.read).toHaveBeenCalledWith({
      hostId: "remote",
      rootPath: "C:\\data\\thread-storage\\thread",
      path: "C:\\data\\thread-storage\\thread\\reports\\note.md",
    });
  });
  it.each(targets)(
    "does not return rejected $source.kind source text for parsing",
    async (target) => {
      const { reader, adapter } = setup();
      for (const file of [
        { content: "rejected", contentEncoding: "utf8" as const, sizeBytes: 1048577 },
        { content: "a\0b", contentEncoding: "utf8" as const, sizeBytes: 3 },
        { content: "/w==", contentEncoding: "base64" as const, sizeBytes: 1 },
        { content: "\ud800", contentEncoding: "utf8" as const, sizeBytes: 3 },
      ]) {
        vi.mocked(adapter.read).mockResolvedValue({ ...file, sha256: "hash" });
        const result = await reader.read(target);
        expect(result.kind).toBe("unsupported");
        expect(result).not.toHaveProperty("snapshot");
        expect(result).not.toHaveProperty("content");
        if (result.kind !== "ready") expect(result.message).toMatch(/1 MiB|non-text|UTF-8/);
      }
    },
  );
  it("does not override a host thread's missing environment with an asserted host", async () => {
    const { reader, adapter } = setup();
    vi.mocked(adapter.thread).mockResolvedValue({
      id: "thread",
      projectId: "project",
      environmentId: null,
    });
    expect(
      (
        await reader.read({
          ...targets[1],
          source: { ...targets[1]!.source, experimental_hostId: "remote" },
        })
      ).kind,
    ).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it("rejects unverified project identity on a host-only target", async () => {
    const { reader, adapter } = setup();
    expect(
      (
        await reader.read({
          path: "/notes/note.md",
          source: {
            kind: "host",
            threadId: null,
            environmentId: null,
            projectId: "other-project",
            experimental_hostId: "remote",
          },
        })
      ).kind,
    ).toBe("error");
    expect(adapter.read).not.toHaveBeenCalled();
  });
  it.each([targets[0]!, targets[1]!])(
    "rejects a mismatched resolved environment for $source.kind",
    async (target) => {
      const { reader, adapter } = setup();
      vi.mocked(adapter.environment).mockResolvedValue({
        id: "other-env",
        projectId: "project",
        hostId: "remote",
        path: "/work",
        status: "ready",
      });
      expect((await reader.read(target)).kind).toBe("error");
      expect(adapter.read).not.toHaveBeenCalled();
    },
  );
  it("preserves valid replacement characters, BOM, Unicode, CRLF and the caller's target unchanged", async () => {
    const { reader, adapter } = setup();
    const text = "\ufeff# 日本語\r\n\r\nActual \ufffd and é  \r\n";
    vi.mocked(adapter.read).mockResolvedValue({
      content: text,
      contentEncoding: "utf8",
      sha256: "hash",
      sizeBytes: new TextEncoder().encode(text).length,
    });
    const target = structuredClone(targets[2]!);
    const result = await reader.read(target);
    expect(result).toMatchObject({ kind: "ready", snapshot: { text } });
    expect(Object.isFrozen(target)).toBe(false);
    if (result.kind === "ready") {
      target.path = "changed.md";
      expect(result.snapshot.target.path).toBe("reports/note.md");
    }
  });
});

describe("bare file names missing at the source root", () => {
  const bare: ReaderTarget = {
    path: "project-instructions.md",
    source: { kind: "workspace", threadId: "thread", environmentId: null, projectId: null },
  };
  function setupMissing(matches: string[]) {
    const { adapter } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(
      new Error("HTTP 404: Path does not exist: /work/project-instructions.md"),
    );
    const findByName = vi.fn(async (): Promise<string[]> => matches);
    const reader = createSourceReader({ ...adapter, findByName });
    return { adapter, reader, findByName };
  }

  it("opens the only file with that name below the root", async () => {
    const { adapter, reader, findByName } = setupMissing(["knowledge/project-instructions.md"]);
    expect(await reader.read(bare)).toMatchObject({
      kind: "ready",
      snapshot: {
        target: { path: "knowledge/project-instructions.md", source: bare.source },
        rootPath: "/work",
        documentPath: "/work/knowledge/project-instructions.md",
      },
    });
    expect(findByName).toHaveBeenCalledExactlyOnceWith({
      hostId: "remote",
      rootPath: "/work",
      name: "project-instructions.md",
    });
    expect(adapter.read).toHaveBeenLastCalledWith({
      hostId: "remote",
      rootPath: "/work",
      path: "/work/knowledge/project-instructions.md",
    });
  });

  it("lists every match when the name is ambiguous", async () => {
    const { reader } = setupMissing(["a/project-instructions.md", "b/project-instructions.md"]);
    const result = await reader.read(bare);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.message).toContain("a/project-instructions.md");
      expect(result.message).toContain("b/project-instructions.md");
    }
  });

  it("keeps the original error when no file has that name", async () => {
    const { reader } = setupMissing([]);
    expect(await reader.read(bare)).toEqual({
      kind: "error",
      message: "HTTP 404: Path does not exist: /work/project-instructions.md",
    });
  });

  it("keeps the original error when the search fails", async () => {
    const { reader, findByName } = setupMissing([]);
    findByName.mockRejectedValueOnce(new Error("Host disconnected"));
    expect(await reader.read(bare)).toEqual({
      kind: "error",
      message: "HTTP 404: Path does not exist: /work/project-instructions.md",
    });
  });

  it("keeps the original error when the unreadable file exists at the root", async () => {
    const { reader, adapter } = setupMissing([
      "project-instructions.md",
      "knowledge/project-instructions.md",
    ]);
    expect(await reader.read(bare)).toMatchObject({ kind: "error" });
    expect(adapter.read).toHaveBeenCalledOnce();
  });

  it("does not search for a path that names a directory", async () => {
    const { reader, findByName } = setupMissing(["other/note.md"]);
    expect((await reader.read(targets[0]!)).kind).toBe("error");
    expect(findByName).not.toHaveBeenCalled();
  });
});

describe("workspace paths missing from the workspace", () => {
  const workspace = targets[0]!;
  const missing = Object.assign(new Error("HTTP 404: Path does not exist: /work/reports/note.md"), {
    status: 404,
  });
  const storageRoot = "/host-data/thread-storage/thread";

  it("opens the same path from the thread's storage", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(missing);
    expect(await reader.read(workspace)).toMatchObject({
      kind: "ready",
      snapshot: {
        target: { path: "reports/note.md", source: { kind: "thread-storage", threadId: "thread" } },
        rootPath: storageRoot,
        documentPath: `${storageRoot}/reports/note.md`,
      },
    });
    expect(adapter.read).toHaveBeenLastCalledWith({
      hostId: "remote",
      rootPath: storageRoot,
      path: `${storageRoot}/reports/note.md`,
    });
  });

  it("prefers the exact storage path over a workspace file found by name", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(missing);
    vi.mocked(adapter.findByName).mockResolvedValue(["docs/note.md"]);
    const bare = { ...workspace, path: "note.md" };
    expect(await reader.read(bare)).toMatchObject({
      kind: "ready",
      snapshot: { documentPath: `${storageRoot}/note.md` },
    });
    expect(adapter.findByName).not.toHaveBeenCalled();
  });

  it("searches the workspace by name when storage also misses", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(missing).mockRejectedValueOnce(missing);
    vi.mocked(adapter.findByName).mockResolvedValue(["docs/note.md"]);
    expect(await reader.read({ ...workspace, path: "note.md" })).toMatchObject({
      kind: "ready",
      snapshot: { documentPath: "/work/docs/note.md" },
    });
  });

  it("keeps the workspace error when thread storage also misses", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(missing).mockRejectedValueOnce(missing);
    expect(await reader.read(workspace)).toEqual({ kind: "error", message: missing.message });
  });

  it("does not look in thread storage for errors other than a missing file", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(
      Object.assign(new Error("Access denied"), { status: 403 }),
    );
    expect(await reader.read(workspace)).toEqual({ kind: "error", message: "Access denied" });
    expect(adapter.storageLocation).not.toHaveBeenCalled();
  });

  it("does not look in thread storage without a thread", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(missing);
    const target = {
      path: "reports/note.md",
      source: { kind: "workspace", threadId: null, environmentId: "env", projectId: null },
    };
    expect(await reader.read(target)).toEqual({ kind: "error", message: missing.message });
    expect(adapter.storageLocation).not.toHaveBeenCalled();
  });

  it("does not open thread storage on another host than the one requested", async () => {
    const { adapter, reader } = setup();
    vi.mocked(adapter.read).mockRejectedValueOnce(missing);
    vi.mocked(adapter.storageLocation).mockResolvedValue({
      hostId: "other",
      storageRootPath: storageRoot,
    });
    const target = {
      ...workspace,
      source: { ...workspace.source, experimental_hostId: "remote" },
    };
    expect(await reader.read(target)).toEqual({ kind: "error", message: missing.message });
    expect(adapter.read).toHaveBeenCalledOnce();
  });
});
