import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { LocalCommitsAhead, LocalCommitsRequest } from "./contract";

const execFileAsync = promisify(execFile);

async function git(path: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", path, ...args]);
  return stdout.trim();
}

export async function countLocalCommitsAhead({
  path,
  branch,
}: LocalCommitsRequest): Promise<LocalCommitsAhead> {
  try {
    if ((await git(path, ["rev-parse", "--abbrev-ref", "HEAD"])) !== branch) {
      return { kind: "unknown" };
    }
    const count = Number(
      await git(path, ["rev-list", "--count", `refs/remotes/origin/${branch}..HEAD`]),
    );
    return Number.isInteger(count) ? { kind: "count", count } : { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}
