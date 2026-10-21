import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { workspaceVideoRequestSchema } from "../contract";
import { MAX_VIDEO_BYTES, videoBytes, videoError, type VideoWireResult } from "./video-content";

const run = promisify(execFile);
let activeReads = 0;
export async function readWorkspaceVideo(
  input: z.infer<typeof workspaceVideoRequestSchema>,
  signal: AbortSignal,
): Promise<VideoWireResult> {
  if (activeReads >= 2)
    return videoError("read", "Two video reads are already running. Wait and retry.");
  activeReads++;
  try {
    const { root, path, revision } = workspaceVideoRequestSchema.parse(input);
    if (!isAbsolute(root)) return videoError("read", "Workspace path unavailable");
    signal.throwIfAborted();
    if (revision.kind === "commit") {
      const object = `${revision.sha}${revision.firstParent ? "^" : ""}:${path}`;
      const options = { cwd: root, signal, timeout: 20_000 };
      const { stdout: size } = await run("git", ["cat-file", "-s", object], {
        ...options,
        maxBuffer: 1024,
      });
      if (Number(size) > MAX_VIDEO_BYTES)
        return videoError(
          "too_large",
          "Video exceeds the 8 MiB preview limit. Use a local player for larger files.",
        );
      const { stdout } = await run("git", ["cat-file", "blob", object], {
        ...options,
        maxBuffer: MAX_VIDEO_BYTES,
        encoding: "buffer",
      });
      return videoBytes(stdout);
    }
    const canonicalRoot = await realpath(root);
    const canonicalPath = await realpath(resolve(root, path));
    const child = relative(canonicalRoot, canonicalPath);
    if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
      return videoError("read", "Video is outside the workspace");
    const file = await open(
      canonicalPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return videoError("read", "Video is not a regular file");
      if (stat.size > MAX_VIDEO_BYTES)
        return videoError(
          "too_large",
          "Video exceeds the 8 MiB preview limit. Use a local player for larger files.",
        );
      const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_VIDEO_BYTES + 1));
      let length = 0;
      while (length < bytes.length) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > stat.size)
        return videoError("stale", "Video changed while reading. Refresh changes.");
      return videoBytes(bytes.subarray(0, length));
    } finally {
      await file.close();
    }
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    )
      return videoError(
        "too_large",
        "Video exceeds the 8 MiB preview limit. Use a local player for larger files.",
      );
    return videoError(
      "read",
      "Could not read video at this revision. Refresh changes or use a local player.",
    );
  } finally {
    activeReads--;
  }
}
