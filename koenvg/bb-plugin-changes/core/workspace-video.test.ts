import { execFileSync } from "node:child_process";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspaceVideo } from "./workspace-video";
import { MAX_VIDEO_BYTES } from "./video-content";

const roots: string[] = [];
const bytes = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");
const signal = () => new AbortController().signal;
async function root() {
  const path = await mkdtemp(join(tmpdir(), "bb-video-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
describe("bounded workspace video host reader", () => {
  it("reads immutable commits and first parents without live workspace bytes", async () => {
    const path = await root();
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", path, ...args], { encoding: "utf8" }).trim();
    git("init", "-q");
    await writeFile(join(path, "old.mp4"), bytes);
    git("add", ".");
    git(
      "-c",
      "user.name=Video Fixture",
      "-c",
      "user.email=video@example.invalid",
      "commit",
      "-qm",
      "before",
    );
    const before = git("rev-parse", "HEAD");
    await writeFile(join(path, "new.mp4"), Buffer.concat([bytes, Buffer.from("after")]));
    git("add", ".");
    git(
      "-c",
      "user.name=Video Fixture",
      "-c",
      "user.email=video@example.invalid",
      "commit",
      "-qm",
      "after",
    );
    const after = git("rev-parse", "HEAD");
    await writeFile(join(path, "old.mp4"), "live data must not be read");
    expect(
      await readWorkspaceVideo(
        {
          root: path,
          path: "old.mp4",
          revision: { kind: "commit", sha: before, firstParent: false },
        },
        signal(),
      ),
    ).toMatchObject({ kind: "ready", content: bytes.toString("base64") });
    expect(
      await readWorkspaceVideo(
        {
          root: path,
          path: "old.mp4",
          revision: { kind: "commit", sha: after, firstParent: true },
        },
        signal(),
      ),
    ).toMatchObject({ kind: "ready", content: bytes.toString("base64") });
    expect(
      await readWorkspaceVideo(
        {
          root: path,
          path: "new.mp4",
          revision: { kind: "commit", sha: after, firstParent: false },
        },
        signal(),
      ),
    ).toMatchObject({
      kind: "ready",
      content: Buffer.concat([bytes, Buffer.from("after")]).toString("base64"),
    });
  });
  it("reads live files but rejects oversized files, directories and escaping symlinks", async () => {
    const path = await root();
    const outside = await root();
    await writeFile(join(path, "clip.mp4"), bytes);
    const request = { root: path, path: "clip.mp4", revision: { kind: "working-tree" as const } };
    expect(await readWorkspaceVideo(request, signal())).toMatchObject({
      kind: "ready",
      sizeBytes: 24,
    });
    await truncate(join(path, "clip.mp4"), MAX_VIDEO_BYTES + 1);
    expect(await readWorkspaceVideo(request, signal())).toMatchObject({
      kind: "error",
      code: "too_large",
    });
    await writeFile(join(outside, "secret.mp4"), bytes);
    await symlink(join(outside, "secret.mp4"), join(path, "escape.mp4"));
    expect(await readWorkspaceVideo({ ...request, path: "escape.mp4" }, signal())).toMatchObject({
      kind: "error",
      code: "read",
    });
    expect(await readWorkspaceVideo({ ...request, path: "../secret.mp4" }, signal())).toMatchObject(
      { kind: "error", code: "read" },
    );
    expect(await readWorkspaceVideo({ ...request, path: "missing.mp4" }, signal())).toMatchObject({
      kind: "error",
      code: "read",
    });
  });
  it("rejects an aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(
      await readWorkspaceVideo(
        { root: await root(), path: "clip.webm", revision: { kind: "working-tree" } },
        controller.signal,
      ),
    ).toMatchObject({ kind: "error", code: "read" });
  });
});
