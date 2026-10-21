import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ReadTextFileRequest, ReadTextFileResult } from "./contract";

export const MAX_TEXT_FILE_BYTES = 64 * 1024;

export async function readTextFile({
  path,
  cwd,
}: ReadTextFileRequest): Promise<ReadTextFileResult> {
  if (!isAbsolute(path) && cwd === null) {
    return { ok: false, message: `Relative path without a working directory: ${path}` };
  }
  try {
    // O_NONBLOCK: opening a named pipe must not wait for a writer.
    const handle = await open(
      cwd === null ? path : resolve(cwd, path),
      constants.O_RDONLY | constants.O_NONBLOCK,
    );
    try {
      if (!(await handle.stat()).isFile())
        return { ok: false, message: `Not a regular file: ${path}` };
      const buffer = Buffer.alloc(MAX_TEXT_FILE_BYTES + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > MAX_TEXT_FILE_BYTES) {
        return {
          ok: false,
          message: `File is larger than ${MAX_TEXT_FILE_BYTES / 1024} KB: ${path}`,
        };
      }
      return { ok: true, text: buffer.toString("utf8", 0, bytesRead) };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { ok: false, message: `File not found: ${path}` };
    return {
      ok: false,
      message: `Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
