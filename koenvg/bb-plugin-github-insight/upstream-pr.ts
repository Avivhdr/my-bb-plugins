import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { UpstreamPr, UpstreamPrRequest } from "./contract";

const execFileAsync = promisify(execFile);

export type Run = (command: string, args: string[], cwd: string) => Promise<string>;

const runCommand: Run = async (command, args, cwd) =>
  String((await execFileAsync(command, args, { cwd, timeout: 20_000 })).stdout).trim();

interface ListedPr {
  url: string;
  state: string;
  isDraft: boolean;
}

function toUpstreamPr(pr: ListedPr): UpstreamPr | null {
  if (pr.state === "OPEN") return { kind: "pr", url: pr.url, state: pr.isDraft ? "draft" : "open" };
  if (pr.state === "MERGED") return { kind: "pr", url: pr.url, state: "merged" };
  if (pr.state === "CLOSED") return { kind: "pr", url: pr.url, state: "closed" };
  return null;
}

/**
 * bb finds a PR by the local branch name. A branch pushed under another name
 * (`git push -u origin bb/x:fix/y`) has its PR on the upstream name instead.
 */
export async function findUpstreamPr(
  { path }: UpstreamPrRequest,
  run: Run = runCommand,
): Promise<UpstreamPr> {
  let upstream: string;
  try {
    const branch = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], path);
    if (branch === "HEAD") return { kind: "none" };
    const merge = await run("git", ["config", "--get", `branch.${branch}.merge`], path);
    upstream = merge.replace(/^refs\/heads\//, "");
    if (upstream === "" || upstream === branch) return { kind: "none" };
  } catch {
    // No upstream configured: git config exits 1.
    return { kind: "none" };
  }
  try {
    const listed = JSON.parse(
      await run(
        "gh",
        [
          "pr",
          "list",
          "--head",
          upstream,
          "--state",
          "all",
          "--limit",
          "5",
          "--json",
          "url,state,isDraft",
        ],
        path,
      ),
    ) as ListedPr[];
    const pr = listed.find((entry) => entry.state === "OPEN") ?? listed[0];
    return (pr && toUpstreamPr(pr)) ?? { kind: "none" };
  } catch (error) {
    return { kind: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
