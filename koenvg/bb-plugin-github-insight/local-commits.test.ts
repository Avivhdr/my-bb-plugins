import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countLocalCommitsAhead } from "./local-commits";

describe("countLocalCommitsAhead", { timeout: 20_000 }, () => {
  let remote: string;
  let worktree: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

  async function commit(message: string) {
    await writeFile(join(worktree, `${message}.txt`), message);
    git(worktree, "add", ".");
    git(worktree, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", message);
  }

  beforeEach(async () => {
    remote = await mkdtemp(join(tmpdir(), "local-commits-remote-"));
    worktree = await mkdtemp(join(tmpdir(), "local-commits-worktree-"));
    git(remote, "init", "-q", "--bare");
    git(worktree, "init", "-q", "-b", "feature");
    git(worktree, "remote", "add", "origin", remote);
    await commit("first");
    git(worktree, "push", "-q", "origin", "feature");
  }, 20_000);

  afterEach(async () => {
    await rm(remote, { recursive: true, force: true });
    await rm(worktree, { recursive: true, force: true });
  });

  it("counts commits that are not on the remote branch", async () => {
    await commit("second");
    await commit("third");

    expect(await countLocalCommitsAhead({ path: worktree, branch: "feature" })).toEqual({
      kind: "count",
      count: 2,
    });
  });

  it("counts none when the worktree matches the remote branch", async () => {
    expect(await countLocalCommitsAhead({ path: worktree, branch: "feature" })).toEqual({
      kind: "count",
      count: 0,
    });
  });

  it("does not know when another branch is checked out", async () => {
    git(worktree, "checkout", "-qb", "other");

    expect(await countLocalCommitsAhead({ path: worktree, branch: "feature" })).toEqual({
      kind: "unknown",
    });
  });

  it("does not know when the remote branch does not exist", async () => {
    git(worktree, "checkout", "-qb", "local-only");

    expect(await countLocalCommitsAhead({ path: worktree, branch: "local-only" })).toEqual({
      kind: "unknown",
    });
  });

  it("does not know when the path is not a git worktree", async () => {
    const empty = await mkdtemp(join(tmpdir(), "local-commits-empty-"));
    try {
      expect(await countLocalCommitsAhead({ path: empty, branch: "feature" })).toEqual({
        kind: "unknown",
      });
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });
});
