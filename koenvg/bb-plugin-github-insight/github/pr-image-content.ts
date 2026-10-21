import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { prImageRequestSchema } from "../contract";
import {
  imageBytes,
  imageError,
  MAX_IMAGE_BYTES,
  type ImageWireResult,
} from "../core/image-content";
import { prImageRefsSchema, type PrImageRefs } from "../core/pr-image-basis";

const run = promisify(execFile);
export function imageMergeBaseArgs(value: PrImageRefs): string[] {
  const { baseRepo, headRepo, baseSha, headSha } = prImageRefsSchema.parse(value);
  const comparison = `${baseSha}...${headRepo.owner}:${headSha}`;
  return [
    "api",
    `repos/${baseRepo.owner}/${baseRepo.repo}/compare/${encodeURIComponent(comparison)}`,
  ];
}
export function prImageArgs(value: z.infer<typeof prImageRequestSchema>): string[] {
  const { owner, repo, sha, path } = prImageRequestSchema.parse(value);
  return [
    "api",
    `repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(sha)}`,
    "-H",
    "Accept: application/vnd.github.raw+json",
  ];
}
export async function readPrImage(
  value: z.infer<typeof prImageRequestSchema>,
  signal: AbortSignal,
): Promise<ImageWireResult> {
  try {
    const { stdout } = await run("gh", prImageArgs(value), {
      signal,
      encoding: "buffer",
      maxBuffer: MAX_IMAGE_BYTES,
      timeout: 20_000,
    });
    return imageBytes(stdout);
  } catch (error) {
    const fields = typeof error === "object" && error !== null ? error : {};
    const code = "code" in fields ? fields.code : null;
    if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return imageError("too_large", "Image exceeds the 4 MiB preview limit");
    const stderr = "stderr" in fields ? String(fields.stderr) : "";
    if (/\b(401|403)\b|authentication|not logged/i.test(stderr))
      return imageError("auth", "GitHub credentials cannot read this image");
    if (/\b404\b/.test(stderr)) return imageError("missing", "Image not found at this revision");
    return imageError("read", "Could not read image from GitHub. Retry or refresh the review.");
  }
}
