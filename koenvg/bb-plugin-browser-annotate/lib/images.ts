import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

export function createImageStore(root: string) {
  const absoluteRoot = resolve(root);

  function pathFor(threadId: string, id: string): string {
    if (!SEGMENT.test(threadId) || !SEGMENT.test(id))
      throw new Error("Invalid annotation image path.");
    return join(absoluteRoot, threadId, `${id}.jpg`);
  }

  function inside(path: string): string {
    const absolute = resolve(path);
    if (!absolute.startsWith(`${absoluteRoot}${sep}`))
      throw new Error("Annotation image path escapes the image directory.");
    return absolute;
  }

  return {
    async write(threadId: string, id: string, bytes: Uint8Array): Promise<string> {
      const path = pathFor(threadId, id);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes, { mode: 0o600 });
      return path;
    },
    async remove(path: string): Promise<void> {
      await rm(inside(path), { force: true });
    },
    async sweep(keep: ReadonlySet<string>, olderThan: number): Promise<void> {
      const threads = await readdir(absoluteRoot, { withFileTypes: true }).catch(() => []);
      for (const thread of threads) {
        if (!thread.isDirectory() || !SEGMENT.test(thread.name)) continue;
        const directory = join(absoluteRoot, thread.name);
        for (const file of await readdir(directory).catch(() => [])) {
          const path = join(directory, file);
          if (keep.has(path)) continue;
          const info = await stat(path).catch(() => null);
          if (info?.isFile() && info.mtimeMs < olderThan) await rm(path, { force: true });
        }
      }
    },
    async exists(path: string): Promise<boolean> {
      try {
        return (await stat(inside(path))).isFile();
      } catch {
        return false;
      }
    },
  };
}

export type ImageStore = ReturnType<typeof createImageStore>;
