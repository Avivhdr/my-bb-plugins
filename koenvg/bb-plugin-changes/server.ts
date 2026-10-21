import { videoError, isVideoPath, type VideoWireResult } from "./core/video-content";
import {
  ContextError,
  MAX_CONTEXT_BYTES,
  contextFailure,
  textRevisions,
  validateText,
  validateContext,
  type TextContextResult,
  type TextRevision,
  type TextSide,
} from "./core/text-context";
import {
  imageError,
  imagePath,
  imageShaSchema,
  imageWire,
  type ImageSide,
  type ImageWireResult,
} from "./core/image-content";
import type { ChangesBasis, ChangedFile } from "./core/changes";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract, hostContract } from "./contract";
import {
  diffQuery,
  messageOf,
  patchTarget,
  targetKey,
  type BranchCommit,
  type ChangesResult,
  type DiffQuery,
  type DiffTarget,
  type PatchesResult,
  type SendFeedbackResult,
} from "./core/changes";
import {
  storedViewedSchema,
  type GetViewedResult,
  type UpdateViewedResult,
  type ViewedMarks,
} from "./core/viewed-files";

export type { rpcContract } from "./contract";

type Sdk = BbPluginApi["sdk"];
type Kv = BbPluginApi["storage"]["kv"];

class ChangesUnavailableError extends Error {
  constructor(
    message: string,
    readonly noGit = false,
  ) {
    super(message);
  }
}

async function environmentIdOf(sdk: Sdk, threadId: string): Promise<string> {
  const thread = await sdk.threads.get({ threadId });
  if (thread.environmentId === null)
    throw new ChangesUnavailableError("This thread has no environment");
  return thread.environmentId;
}

async function baseBranchOf(sdk: Sdk, environmentId: string): Promise<string> {
  const status = await sdk.environments.status({ environmentId });
  if (status.outcome === "not_applicable") throw new ChangesUnavailableError(status.message, true);
  if (status.outcome === "unavailable") throw new ChangesUnavailableError(status.failure.message);
  const defaultBranch = status.workspace.branch.defaultBranch;
  const { remoteBranches } = await sdk.environments.diffBranches({ environmentId });
  // A local default branch is often behind the remote, which would pull merged work into the diff.
  const remoteDefault = `origin/${defaultBranch}`;
  return remoteBranches.includes(remoteDefault) ? remoteDefault : defaultBranch;
}

async function branchCommits(
  sdk: Sdk,
  environmentId: string,
  baseBranch: string,
  warn: (message: string) => void,
): Promise<BranchCommit[]> {
  try {
    const status = await sdk.environments.status({ environmentId, mergeBaseBranch: baseBranch });
    const commits =
      status.outcome === "available" ? (status.workspace.mergeBase?.commits ?? []) : [];
    return commits.map(({ sha, shortSha, subject }) => ({ sha, shortSha, subject }));
  } catch (error) {
    // bb 0.44 rejects its own merge-base status for some branches; the diff must still load.
    warn(`Branch commits unavailable: ${messageOf(error)}`);
    return [];
  }
}

function failure(error: unknown): { kind: "no_git" } | { kind: "error"; message: string } {
  if (error instanceof ChangesUnavailableError && error.noGit) return { kind: "no_git" };
  return { kind: "error", message: messageOf(error) };
}

async function checkoutHead(sdk: Sdk, environmentId: string): Promise<string | null> {
  try {
    const status = await sdk.environments.status({ environmentId });
    return status.outcome === "available" && "headSha" in status.workspace.checkout
      ? status.workspace.checkout.headSha
      : null;
  } catch {
    return null;
  }
}

async function getTextContext(
  sdk: Sdk,
  threadId: string,
  basis: ChangesBasis,
  file: ChangedFile,
  patch: string,
): Promise<TextContextResult> {
  try {
    validateText(patch, new TextEncoder().encode(patch).length);
    const ownsEnvironment = async () => {
      if ((await environmentIdOf(sdk, threadId)) !== basis.environmentId)
        throw new ContextError("stale", "Environment changed. Refresh changes.");
    };
    await ownsEnvironment();
    const revisions = textRevisions(basis, file);
    const read = async (revision: TextRevision): Promise<TextSide> => {
      if (revision.kind === "absent") return revision;
      const result = await sdk.environments.diffFile({
        environmentId: basis.environmentId,
        path: revision.path,
        ...(revision.kind === "working_tree"
          ? { target: "uncommitted" as const, side: "new" as const }
          : { target: "commit" as const, sha: revision.sha, side: revision.side }),
      });
      if (result.path !== revision.path)
        throw new ContextError("stale", "Context path changed. Refresh changes.");
      if (
        result.sizeBytes > MAX_CONTEXT_BYTES ||
        result.content.length > Math.ceil(MAX_CONTEXT_BYTES / 3) * 4
      )
        throw new ContextError("too_large", "Context exceeds the 1 MiB or 20,000 line limit.");
      let contents: string;
      if (result.contentEncoding === "utf8") contents = result.content;
      else if (result.contentEncoding === "base64") {
        const bytes = Buffer.from(result.content, "base64");
        if (bytes.toString("base64") !== result.content || bytes.length !== result.sizeBytes)
          throw new ContextError("unsupported", "Context is not valid UTF-8 text.");
        try {
          contents = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
        } catch {
          throw new ContextError("unsupported", "Context is not valid UTF-8 text.");
        }
      } else throw new ContextError("unsupported", "Context is not valid UTF-8 text.");
      validateText(contents, result.sizeBytes);
      return { kind: "text", revision, contents, sizeBytes: result.sizeBytes };
    };
    const [old, after] = await Promise.all([read(revisions.old), read(revisions.new)]);
    await ownsEnvironment();
    const result = { kind: "ready" as const, old, new: after };
    validateContext({ threadId, basis, file, patch, generation: 0 }, result);
    return result;
  } catch (error) {
    return contextFailure(error);
  }
}

async function getImage(
  sdk: Sdk,
  threadId: string,
  basis: ChangesBasis,
  file: ChangedFile,
  side: ImageSide,
): Promise<ImageWireResult> {
  try {
    if ((await environmentIdOf(sdk, threadId)) !== basis.environmentId)
      return imageError("stale", "Environment changed. Refresh changes.");
    const path = imagePath(file, side);
    if (path === null) return { kind: "absent" };
    const target = basis.target;
    const live = side === "after" && (target.kind === "all" || target.kind === "uncommitted");
    const sha =
      target.kind === "commit"
        ? target.sha
        : side === "before" && target.kind !== "uncommitted"
          ? basis.mergeBaseRef
          : basis.headSha;
    if (!live && !imageShaSchema.safeParse(sha).success)
      return imageError("stale", "Image revision unavailable. Refresh changes.");
    const result = await sdk.environments.diffFile({
      environmentId: basis.environmentId,
      path,
      ...(live
        ? { target: "uncommitted" as const, side: "new" as const }
        : {
            target: "commit" as const,
            sha: sha!,
            side:
              target.kind === "commit" && side === "before" ? ("old" as const) : ("new" as const),
          }),
    });
    return imageWire(result);
  } catch {
    return imageError("read", "Could not read image at this revision");
  }
}

async function getChanges(
  sdk: Sdk,
  warn: (message: string) => void,
  threadId: string,
  target: DiffTarget,
): Promise<ChangesResult> {
  try {
    const environmentId = await environmentIdOf(sdk, threadId);
    const baseBranch = await baseBranchOf(sdk, environmentId);
    const query = diffQuery(target, baseBranch);
    const [commits, { diff, headSha, stable }] = await Promise.all([
      branchCommits(sdk, environmentId, baseBranch, warn),
      (async () => {
        let headSha = await checkoutHead(sdk, environmentId);
        let diff = await sdk.environments.diffFiles({ environmentId, ...query });
        let endHead = await checkoutHead(sdk, environmentId);
        if (headSha !== endHead) {
          headSha = endHead;
          diff = await sdk.environments.diffFiles({ environmentId, ...query });
          endHead = await checkoutHead(sdk, environmentId);
        }
        return { diff, headSha, stable: headSha !== null && headSha === endHead };
      })(),
    ]);
    if (diff.outcome === "not_applicable") return { kind: "no_git" };
    if (diff.outcome === "unavailable") return { kind: "error", message: diff.failure.message };
    return {
      kind: "ok",
      environmentId,
      query,
      imageBasis: stable
        ? { environmentId, headSha: headSha!, mergeBaseRef: diff.mergeBaseRef ?? null, target }
        : null,
      files: diff.files.map(
        ({ path, previousPath, additions, deletions, binary, loadMode, changeKind, origin }) => ({
          path,
          previousPath,
          additions,
          deletions,
          binary,
          loadMode,
          status: origin === "untracked" ? ("untracked" as const) : changeKind,
        }),
      ),
      patches: Object.fromEntries(diff.initialPatches.map(({ path, patch }) => [path, patch])),
      commits,
    };
  } catch (error) {
    return failure(error);
  }
}

async function getPatches(
  sdk: Sdk,
  threadId: string,
  query: DiffQuery,
  paths: string[],
): Promise<PatchesResult> {
  try {
    const environmentId = await environmentIdOf(sdk, threadId);
    const result = await sdk.environments.diffPatch({
      environmentId,
      paths,
      target: patchTarget(query),
    });
    if (result.outcome === "not_applicable") return { kind: "error", message: result.message };
    if (result.outcome === "unavailable") return { kind: "error", message: result.failure.message };
    return {
      kind: "ok",
      patches: Object.fromEntries(result.patches.map(({ path, patch }) => [path, patch])),
    };
  } catch (error) {
    return { kind: "error", message: messageOf(error) };
  }
}

async function sendFeedback(sdk: Sdk, threadId: string, text: string): Promise<SendFeedbackResult> {
  try {
    const result = await sdk.threads.send({
      threadId,
      mode: "auto",
      input: [{ type: "text", text, mentions: [] }],
    });
    return { kind: "sent", delivery: result.delivery };
  } catch (error) {
    return { kind: "error", message: messageOf(error) };
  }
}

function createViewedMarksKv(kv: Kv) {
  const queues = new Map<string, Promise<unknown>>();

  function keyOf(threadId: string, target: DiffTarget): string {
    return `viewed:v1:${threadId}:${targetKey(target)}`;
  }

  async function read(key: string): Promise<ViewedMarks> {
    const stored = storedViewedSchema.safeParse(await kv.get(key));
    return stored.success ? stored.data.marks : {};
  }

  function inOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => undefined);
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  }

  return {
    async get(threadId: string, target: DiffTarget): Promise<GetViewedResult> {
      try {
        return { kind: "ok", marks: await read(keyOf(threadId, target)) };
      } catch (error) {
        return { kind: "error", message: messageOf(error) };
      }
    },
    update(
      threadId: string,
      target: DiffTarget,
      set: ViewedMarks,
      remove: readonly string[],
    ): Promise<UpdateViewedResult> {
      const key = keyOf(threadId, target);
      return inOrder(key, async () => {
        const marks: Record<string, string> = { ...(await read(key)), ...set };
        for (const path of remove) delete marks[path];
        if (Object.keys(marks).length === 0) await kv.delete(key);
        else await kv.set(key, { v: 1, marks });
        return { kind: "ok" as const };
      }).catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
    },
  };
}

export default async function plugin(bb: BbPluginApi) {
  const viewed = createViewedMarksKv(bb.storage.kv);
  const host = bb.hosts.experimental_client({ contract: hostContract });
  bb.rpc.register(rpcContract, {
    getVideo: async ({ threadId, basis, file, side }): Promise<VideoWireResult> => {
      try {
        if ((await environmentIdOf(bb.sdk, threadId)) !== basis.environmentId)
          return videoError("stale", "Environment changed. Refresh changes.");
        const path = imagePath(file, side);
        if (path === null) return { kind: "absent" };
        if (!isVideoPath(file.path) && !isVideoPath(file.previousPath ?? ""))
          return videoError("unsupported", "This file is not an MP4 or WebM video");
        const environment = await bb.sdk.environments.get({ environmentId: basis.environmentId });
        if (!environment.path) return videoError("read", "Workspace path unavailable");
        const target = basis.target;
        const live = side === "after" && (target.kind === "all" || target.kind === "uncommitted");
        const sha =
          target.kind === "commit"
            ? target.sha
            : side === "before" && target.kind !== "uncommitted"
              ? basis.mergeBaseRef
              : basis.headSha;
        if (!live && !imageShaSchema.safeParse(sha).success)
          return videoError("stale", "Video revision unavailable. Refresh changes.");
        const result = await host.call(
          "readVideo",
          {
            root: environment.path,
            path,
            revision: live
              ? { kind: "working-tree" }
              : {
                  kind: "commit",
                  sha: sha!,
                  firstParent: target.kind === "commit" && side === "before",
                },
          },
          { hostId: environment.hostId, timeoutMs: 25_000 },
        );
        return (await environmentIdOf(bb.sdk, threadId)) === basis.environmentId
          ? result
          : videoError("stale", "Environment changed. Refresh changes.");
      } catch {
        return videoError(
          "read",
          "Could not read video at this revision. Refresh changes or use a local player.",
        );
      }
    },
    getTextContext: ({ threadId, basis, file, patch }) =>
      getTextContext(bb.sdk, threadId, basis, file, patch),
    getImage: ({ threadId, basis, file, side }) => getImage(bb.sdk, threadId, basis, file, side),
    getChanges: ({ threadId, target }) =>
      getChanges(bb.sdk, (message) => bb.log.warn(message), threadId, target),
    getPatches: ({ threadId, query, paths }) => getPatches(bb.sdk, threadId, query, paths),
    sendFeedback: ({ threadId, text }) => sendFeedback(bb.sdk, threadId, text),
    getViewed: ({ threadId, target }) => viewed.get(threadId, target),
    updateViewed: ({ threadId, target, set, remove }) =>
      viewed.update(threadId, target, set, remove),
  });
}
