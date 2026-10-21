import { textRevisions, type ContextFailure, type Snapshot } from "../../core/text-context";
import { diffQuery, type ChangedFile, type DiffTarget } from "../../core/changes";

export const WORKSPACE_PATH = "bb-plugin-changes/tests/bb-renderer/files/workspace.txt";
export const RENAMED_PATH = "bb-plugin-changes/tests/bb-renderer/files/renamed.txt";
export const DELETED_PATH = "bb-plugin-changes/tests/bb-renderer/files/deleted.txt";
export const WORKSPACE_TEXT = "BBP-215 live workspace content, not historical diff content.";
export const RENAMED_TEXT = "BBP-215 current renamed file, not the previous path.";

export const CONTEXT_PATH = "context.txt";
export const CONTEXT_OLD =
  Array.from({ length: 400 }, (_, index) =>
    index === 199 ? "old value" : `unchanged line ${index + 1}`,
  ).join("\n") + "\n";
export const CONTEXT_NEW = CONTEXT_OLD.replace("old value", "new value");
export const CONTEXT_PATCH =
  "diff --git a/context.txt b/context.txt\n--- a/context.txt\n+++ b/context.txt\n@@ -199,3 +199,3 @@\n unchanged line 199\n-old value\n+new value\n unchanged line 201\n";
export function loopbackOrigin(input: string): string {
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    input !== url.origin
  ) {
    throw new Error("BB_RENDERER_URL must be a bare loopback HTTP origin");
  }
  return url.origin;
}

export function unsupportedSlotBundle(bundle: string): string {
  const property = "renderCustomHeader:";
  if (bundle.split(property).length !== 2) {
    throw new Error("Expected exactly one compiled renderCustomHeader property");
  }
  return bundle.replace(property, "renderHeaderFilenameSuffix:");
}

function file(
  path: string,
  status: ChangedFile["status"],
  previousPath: string | null = null,
): ChangedFile {
  return {
    path,
    previousPath,
    status,
    additions: 1,
    deletions: 1,
    binary: false,
    loadMode: "auto",
  };
}

function patch(path: string, previousPath = path): string {
  return `diff --git a/${previousPath} b/${path}\n--- a/${previousPath}\n+++ b/${path}\n@@ -1 +1 @@\n-before\n+Historical patch content. This is not the live workspace file.\n`;
}

export function rendererFixture(threadId: string, environmentId: string) {
  const files = [
    file(WORKSPACE_PATH, "modified"),
    file(RENAMED_PATH, "renamed", "bbp-215-previous-name.txt"),
    file(DELETED_PATH, "deleted"),
    file(CONTEXT_PATH, "modified"),
  ];
  const patches = Object.fromEntries(
    files.map((item) => [item.path, patch(item.path, item.previousPath ?? item.path)]),
  );
  patches[CONTEXT_PATH] = CONTEXT_PATCH;
  const marks = new Map<string, Record<string, string>>();
  let tabs = {
    revision: 1,
    tabs: [
      { id: "thread-info:thread-info:none", kind: "thread-info" },
      { id: "git-diff:git-diff:none", kind: "git-diff" },
      { id: "new-tab:new-tab:none", kind: "new-tab" },
    ] as unknown[],
  };
  const calls: { method: string; input: Record<string, unknown> }[] = [];
  let nextContextError: ContextFailure | null = null;
  let nextContextDelay: Promise<void> | null = null;
  return {
    calls,
    failNextContext(code: "read" | "stale") {
      nextContextError = {
        kind: "error",
        code,
        message:
          code === "read"
            ? "Could not load context. Retry."
            : "Context does not match this diff. Refresh changes.",
      };
    },
    deferNextContext() {
      let release!: () => void;
      nextContextDelay = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    tabs(method: string, input?: { expectedRevision: number; tabs: unknown[] }) {
      if (method === "GET") return tabs;
      if (method !== "PUT" || input?.expectedRevision !== tabs.revision)
        throw new Error("Unexpected tab write");
      tabs = { revision: tabs.revision + 1, tabs: input.tabs };
      return tabs;
    },
    rpc(method: string, input: Record<string, unknown>): unknown {
      if (input.threadId !== threadId) throw new Error("Unexpected RPC thread");
      calls.push({ method, input });
      const target = input.target as DiffTarget;
      switch (method) {
        case "getChanges":
          return {
            kind: "ok",
            environmentId,
            query: diffQuery(target, "origin/main"),
            files,
            imageBasis: {
              environmentId,
              headSha: "a".repeat(40),
              mergeBaseRef: "b".repeat(40),
              target,
            },
            patches,
            commits: [],
          };
        case "getTextContext": {
          const snapshot = input as unknown as Snapshot;
          if (
            snapshot.file.path !== CONTEXT_PATH ||
            snapshot.patch !== CONTEXT_PATCH ||
            snapshot.basis.environmentId !== environmentId
          )
            throw new Error("Unexpected context snapshot");
          const revisions = textRevisions(snapshot.basis, snapshot.file);
          const result = nextContextError ?? {
            kind: "ready",
            old: {
              kind: "text",
              revision: revisions.old,
              contents: CONTEXT_OLD,
              sizeBytes: new TextEncoder().encode(CONTEXT_OLD).length,
            },
            new: {
              kind: "text",
              revision: revisions.new,
              contents: CONTEXT_NEW,
              sizeBytes: new TextEncoder().encode(CONTEXT_NEW).length,
            },
          };
          nextContextError = null;
          const delay = nextContextDelay;
          nextContextDelay = null;
          return delay ? delay.then(() => result) : result;
        }
        case "getPatches":
          return { kind: "ok", patches };
        case "getViewed":
          return { kind: "ok", marks: marks.get(JSON.stringify(target)) ?? {} };
        case "updateViewed": {
          const key = JSON.stringify(target);
          const next = { ...marks.get(key), ...(input.set as Record<string, string>) };
          for (const path of input.remove as string[]) delete next[path];
          marks.set(key, next);
          return { kind: "ok" };
        }
        default:
          throw new Error(`Unexpected Changes RPC: ${method}`);
      }
    },
  };
}
