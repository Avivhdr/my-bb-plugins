// @vitest-environment node
import { mkdtemp, readFile, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createImageStore } from "../lib/images";

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "annotate-images-"));
  return { root, images: createImageStore(root) };
}

describe("image store", () => {
  it("writes a private file per thread and annotation and deletes it", async () => {
    const { root, images } = await setup();

    const path = await images.write("thr", "a", new Uint8Array([1, 2, 3]));

    expect(path).toBe(join(root, "thr", "a.jpg"));
    expect([...(await readFile(path))]).toEqual([1, 2, 3]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await images.exists(path)).toBe(true);
    await images.remove(path);
    expect(await images.exists(path)).toBe(false);
  });

  it("rejects ids that would leave the image directory", async () => {
    const { images } = await setup();

    await expect(images.write("..", "a", new Uint8Array([1]))).rejects.toThrow("Invalid");
    await expect(images.write("thr", "../x", new Uint8Array([1]))).rejects.toThrow("Invalid");
    await expect(images.remove("/etc/passwd")).rejects.toThrow("escapes");
  });

  it("ignores a missing file on delete", async () => {
    const { root, images } = await setup();

    await expect(images.remove(join(root, "thr", "gone.jpg"))).resolves.toBeUndefined();
  });

  it("sweeps old files that no annotation uses and keeps the rest", async () => {
    const { images } = await setup();
    const old = await images.write("thr", "old", new Uint8Array([1]));
    const used = await images.write("thr", "used", new Uint8Array([1]));
    const fresh = await images.write("thr", "fresh", new Uint8Array([1]));
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(old, past, past);
    await utimes(used, past, past);

    await images.sweep(new Set([used]), Date.now() - 60 * 60 * 1000);

    expect(await images.exists(old)).toBe(false);
    expect(await images.exists(used)).toBe(true);
    expect(await images.exists(fresh)).toBe(true);
  });
});
