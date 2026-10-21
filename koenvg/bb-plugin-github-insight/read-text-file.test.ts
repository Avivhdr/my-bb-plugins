import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTextFile } from "./read-text-file";

describe("readTextFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "read-text-file-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads a path relative to the working directory", async () => {
    await writeFile(join(dir, "reply.md"), "Renamed in abc123\n");

    const result = await readTextFile({ path: "reply.md", cwd: dir });

    expect(result).toEqual({ ok: true, text: "Renamed in abc123\n" });
  });

  it("reads an absolute path without a working directory", async () => {
    await writeFile(join(dir, "reply.md"), "Done");

    const result = await readTextFile({
      path: join(dir, "reply.md"),
      cwd: null,
    });

    expect(result).toEqual({ ok: true, text: "Done" });
  });

  it("names a missing file", async () => {
    const result = await readTextFile({ path: "missing.md", cwd: dir });

    expect(result).toEqual({ ok: false, message: "File not found: missing.md" });
  });

  it("refuses a file over 64 KB", async () => {
    await writeFile(join(dir, "big.md"), "x".repeat(64 * 1024 + 1));

    const result = await readTextFile({ path: "big.md", cwd: dir });

    expect(result).toEqual({ ok: false, message: "File is larger than 64 KB: big.md" });
  });

  it("reads a file of exactly 64 KB", async () => {
    await writeFile(join(dir, "limit.md"), "x".repeat(64 * 1024));

    const result = await readTextFile({ path: "limit.md", cwd: dir });

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a relative path without a working directory", async () => {
    const result = await readTextFile({ path: "reply.md", cwd: null });

    expect(result).toEqual({
      ok: false,
      message: "Relative path without a working directory: reply.md",
    });
  });

  it("refuses a device such as /dev/zero", async () => {
    const result = await readTextFile({ path: "/dev/zero", cwd: null });

    expect(result).toEqual({ ok: false, message: "Not a regular file: /dev/zero" });
  });

  it("refuses a named pipe without waiting for a writer", async () => {
    execFileSync("mkfifo", [join(dir, "pipe")]);

    const result = await readTextFile({ path: "pipe", cwd: dir });

    expect(result).toEqual({ ok: false, message: "Not a regular file: pipe" });
  });

  it("refuses a directory", async () => {
    await mkdir(join(dir, "folder"));

    const result = await readTextFile({ path: "folder", cwd: dir });

    expect(result).toEqual({ ok: false, message: "Not a regular file: folder" });
  });
});
