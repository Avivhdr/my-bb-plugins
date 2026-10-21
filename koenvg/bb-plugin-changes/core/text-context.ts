import { z } from "zod";
import type { ChangedFile, ChangesBasis } from "./changes";
import { imagePath, imagePathSchema, imageShaSchema } from "./image-content";

export const MAX_CONTEXT_BYTES = 1024 * 1024;
export const MAX_CONTEXT_LINES = 20_000;
export type Snapshot = Readonly<{
  threadId: string;
  basis: ChangesBasis;
  generation: number;
  file: ChangedFile;
  patch: string;
}>;

const presentRevisionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("commit"),
      path: imagePathSchema,
      sha: imageShaSchema,
      side: z.enum(["old", "new"]),
    })
    .strict(),
  z.object({ kind: z.literal("working_tree"), path: imagePathSchema }).strict(),
]);
const revisionSchema = z.union([
  z.object({ kind: z.literal("absent") }).strict(),
  presentRevisionSchema,
]);
export type TextRevision = z.infer<typeof revisionSchema>;
export type TextRevisionPair = { old: TextRevision; new: TextRevision };
const textSideSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("absent") }).strict(),
  z
    .object({
      kind: z.literal("text"),
      revision: presentRevisionSchema,
      contents: z.string().max(MAX_CONTEXT_BYTES),
      sizeBytes: z.number().int().min(0).max(MAX_CONTEXT_BYTES),
    })
    .strict(),
]);
export type TextSide = z.infer<typeof textSideSchema>;
export const textContextResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), old: textSideSchema, new: textSideSchema }).strict(),
  z
    .object({
      kind: z.literal("error"),
      code: z.enum(["read", "stale", "unsupported", "too_large"]),
      message: z.string(),
    })
    .strict(),
]);
export type TextContextResult = z.infer<typeof textContextResultSchema>;
export type ContextFailure = Extract<TextContextResult, { kind: "error" }>;

export class ContextError extends Error {
  constructor(
    readonly code: ContextFailure["code"],
    message: string,
  ) {
    super(message);
  }
}
export function contextFailure(error: unknown): ContextFailure {
  return error instanceof ContextError
    ? { kind: "error", code: error.code, message: error.message }
    : { kind: "error", code: "read", message: "Could not load context. Retry." };
}
function mismatch(): never {
  throw new ContextError("stale", "Context does not match this diff. Refresh changes.");
}

function validateContextFile(file: ChangedFile): void {
  if (file.binary || file.loadMode === "too_large" || file.status === "type_changed")
    throw new ContextError("unsupported", "Context is unavailable for this file.");
  for (const path of [file.path, ...(file.previousPath === null ? [] : [file.previousPath])]) {
    if (!imagePathSchema.safeParse(path).success)
      throw new ContextError("unsupported", "Context requires a safe relative file path.");
    if (/[^!-~]|["\\]/.test(path))
      throw new ContextError("unsupported", "Context is unavailable for quoted file paths.");
  }
  if (["renamed", "copied"].includes(file.status) !== (file.previousPath !== null)) mismatch();
}

export function textRevisions(basis: ChangesBasis, file: ChangedFile): TextRevisionPair {
  validateContextFile(file);
  const revision = (side: "before" | "after"): TextRevision => {
    const path = imagePath(file, side);
    if (path === null) return { kind: "absent" };
    const target = basis.target;
    if (side === "after" && (target.kind === "all" || target.kind === "uncommitted"))
      return { kind: "working_tree", path };
    const sha =
      target.kind === "commit"
        ? target.sha
        : side === "before" && target.kind !== "uncommitted"
          ? basis.mergeBaseRef
          : basis.headSha;
    if (!imageShaSchema.safeParse(sha).success)
      throw new ContextError("stale", "Context revision unavailable. Refresh changes.");
    return {
      kind: "commit",
      path,
      sha: sha!,
      side: target.kind === "commit" && side === "before" ? "old" : "new",
    };
  };
  return { old: revision("before"), new: revision("after") };
}

export function validateText(contents: string, sizeBytes: number): void {
  const bytes = new TextEncoder().encode(contents);
  if (
    bytes.length > MAX_CONTEXT_BYTES ||
    sizeBytes > MAX_CONTEXT_BYTES ||
    splitLines(contents).length > MAX_CONTEXT_LINES
  )
    throw new ContextError("too_large", "Context exceeds the 1 MiB or 20,000 line limit.");
  if (
    !Number.isInteger(sizeBytes) ||
    bytes.length !== sizeBytes ||
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) !== contents ||
    contents.includes("\0")
  )
    throw new ContextError("unsupported", "Context is not valid UTF-8 text.");
}
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function validateContext(snapshot: Snapshot, input: unknown): { old: string; new: string } {
  const parsed = textContextResultSchema.safeParse(input);
  if (!parsed.success)
    throw new ContextError("unsupported", "Invalid context response. Refresh changes.");
  if (parsed.data.kind === "error") throw new ContextError(parsed.data.code, parsed.data.message);
  const revisions = textRevisions(snapshot.basis, snapshot.file);
  const contents = (side: "old" | "new") => {
    const value = parsed.data.kind === "ready" ? parsed.data[side] : mismatch();
    const expected = revisions[side];
    if (value.kind === "absent") {
      if (expected.kind !== "absent") mismatch();
      return "";
    }
    if (JSON.stringify(value.revision) !== JSON.stringify(expected)) mismatch();
    validateText(value.contents, value.sizeBytes);
    return value.contents;
  };
  const pair = { old: contents("old"), new: contents("new") };
  validatePatch(snapshot.file, snapshot.patch, pair.old, pair.new);
  return pair;
}

// Pierre accepts changes outside hunks. Exact application is the revision boundary.
export function validatePatch(
  file: ChangedFile,
  patch: string,
  oldText: string,
  newText: string,
): void {
  validateContextFile(file);
  if (patch.startsWith('diff --git "'))
    throw new ContextError("unsupported", "Context is unavailable for quoted file paths.");
  validateText(patch, new TextEncoder().encode(patch).length);
  const rows = splitLines(patch);
  const firstHunk = rows.findIndex((row) => row.startsWith("@@ "));
  if (firstHunk < 0) mismatch();
  const header = rows.slice(0, firstHunk).map((row) => row.replace(/\n$/, ""));
  const oldPath = file.previousPath ?? file.path;
  const added = file.status === "added" || file.status === "untracked";
  const deleted = file.status === "deleted";
  const oldHeader = `--- ${added ? "/dev/null" : `a/${oldPath}`}`;
  const newHeader = `+++ ${deleted ? "/dev/null" : `b/${file.path}`}`;
  if (
    header[0] !== `diff --git a/${oldPath} b/${file.path}` ||
    header.filter((row) => row.startsWith("--- ")).join() !== oldHeader ||
    header.filter((row) => row.startsWith("+++ ")).join() !== newHeader
  )
    mismatch();
  for (const row of header.slice(1)) {
    if (row === oldHeader || row === newHeader) continue;
    if (/^index [a-f\d]+\.\.[a-f\d]+(?: 100(?:644|755))?$/.test(row)) continue;
    if (/^new file mode 100(?:644|755)$/.test(row) && added) continue;
    if (/^deleted file mode 100(?:644|755)$/.test(row) && deleted) continue;
    if (/^(old|new) mode 100(?:644|755)$/.test(row) && !added && !deleted) continue;
    if (
      /^similarity index (?:100|\d{1,2})%$/.test(row) &&
      ["renamed", "copied"].includes(file.status)
    )
      continue;
    if (
      row === `${file.status === "copied" ? "copy" : "rename"} from ${oldPath}` &&
      ["renamed", "copied"].includes(file.status)
    )
      continue;
    if (
      row === `${file.status === "copied" ? "copy" : "rename"} to ${file.path}` &&
      ["renamed", "copied"].includes(file.status)
    )
      continue;
    mismatch();
  }
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const output: string[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let i = firstHunk;
  while (i < rows.length) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[^\n]*\n$/.exec(rows[i++]!);
    if (!match) mismatch();
    const oldCount = Number(match[2] ?? 1);
    const newCount = Number(match[4] ?? 1);
    const oldStart = Number(match[1]) - (oldCount === 0 ? 0 : 1);
    const newStart = Number(match[3]) - (newCount === 0 ? 0 : 1);
    if (
      ![oldCount, newCount, oldStart, newStart].every(Number.isSafeInteger) ||
      oldStart < oldIndex ||
      oldStart > oldLines.length ||
      newStart < newIndex ||
      oldCount + newCount === 0
    )
      mismatch();
    const gap = oldLines.slice(oldIndex, oldStart);
    if (newIndex + gap.length !== newStart) mismatch();
    output.push(...gap);
    oldIndex = oldStart;
    newIndex = newStart;
    let usedOld = 0;
    let usedNew = 0;
    while (i < rows.length && !rows[i]!.startsWith("@@ ")) {
      const row = rows[i++]!;
      const sign = row[0];
      if (![" ", "-", "+"].includes(sign!) || !row.endsWith("\n")) mismatch();
      let text = row.slice(1);
      if (
        rows[i] === "\\ No newline at end of file\n" ||
        rows[i] === "\\ No newline at end of file"
      ) {
        text = text.slice(0, -1);
        i++;
      }
      if (sign !== "+") {
        if (oldLines[oldIndex++] !== text) mismatch();
        usedOld++;
      }
      if (sign !== "-") {
        if (newLines[newIndex++] !== text) mismatch();
        output.push(text);
        usedNew++;
      }
    }
    if (usedOld !== oldCount || usedNew !== newCount) mismatch();
  }
  output.push(...oldLines.slice(oldIndex));
  if (output.join("") !== newText) mismatch();
}
