import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { prImageRequestSchema } from "../contract";
import {
  MAX_VIDEO_BYTES,
  videoBytes,
  videoError,
  type VideoWireResult,
} from "../core/video-content";
import { prImageArgs } from "./pr-image-content";

const run = promisify(execFile);
let activeReads = 0;
export async function readPrVideo(
  value: z.infer<typeof prImageRequestSchema>,
  signal: AbortSignal,
): Promise<VideoWireResult> {
  if (activeReads >= 2)
    return videoError("read", "Two video reads are already running. Wait and retry.");
  activeReads++;
  try {
    const args = prImageArgs(value);
    const { stdout: metadata } = await run(
      "gh",
      [args[0]!, args[1]!, "-H", "Accept: application/vnd.github.object+json", "--jq", ".size"],
      { signal, maxBuffer: 4096, timeout: 20_000 },
    );
    const size = Number(metadata.trim());
    if (!Number.isSafeInteger(size) || size < 1)
      return videoError("read", "Video size unavailable at this revision");
    if (size > MAX_VIDEO_BYTES)
      return videoError(
        "too_large",
        "Video exceeds the 8 MiB preview limit. Use a local player for larger files.",
      );
    const { stdout } = await run("gh", args, {
      signal,
      encoding: "buffer",
      maxBuffer: MAX_VIDEO_BYTES,
      timeout: 20_000,
    });
    if (stdout.length !== size)
      return videoError("read", "Incomplete video at this revision. Retry the preview.");
    return videoBytes(stdout);
  } catch (error) {
    const fields = typeof error === "object" && error !== null ? error : {};
    if ("code" in fields && fields.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return videoError(
        "too_large",
        "Video exceeds the 8 MiB preview limit. Use a local player for larger files.",
      );
    const stderr = "stderr" in fields ? String(fields.stderr) : "";
    if (/\b(401|403)\b|authentication|not logged/i.test(stderr))
      return videoError("auth", "GitHub credentials on this host cannot read this video");
    if (/\b404\b/.test(stderr)) return videoError("missing", "Video not found at this revision");
    return videoError("read", "Could not read video from GitHub. Retry or use a local player.");
  } finally {
    activeReads--;
  }
}
