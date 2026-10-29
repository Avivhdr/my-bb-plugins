import { describe, expect, it, vi } from "vitest";
import { findUpstreamPr, type Run } from "./upstream-pr";

function runner({
  branch = "bb/dev-1-frontend",
  merge = "refs/heads/fix/DEV-1-thing",
  listed = "[]",
}: { branch?: string; merge?: string | null; listed?: string | Error } = {}) {
  return vi.fn<Run>(async (command, args) => {
    if (command === "git" && args[0] === "rev-parse") return branch;
    if (command === "git" && args[0] === "config") {
      if (merge === null) throw new Error("exit 1");
      return merge;
    }
    if (listed instanceof Error) throw listed;
    return listed;
  });
}

const request = { path: "/work/frontend" };

describe("findUpstreamPr", () => {
  it("lists PRs whose head is the upstream branch, in the environment", async () => {
    const run = runner({
      listed: JSON.stringify([
        { url: "https://github.com/o/r/pull/9", state: "OPEN", isDraft: false },
      ]),
    });
    expect(await findUpstreamPr(request, run)).toEqual({
      kind: "pr",
      url: "https://github.com/o/r/pull/9",
      state: "open",
    });
    expect(run).toHaveBeenLastCalledWith(
      "gh",
      expect.arrayContaining(["pr", "list", "--head", "fix/DEV-1-thing", "--state", "all"]),
      "/work/frontend",
    );
  });

  it("prefers an open PR over a newer closed one", async () => {
    const run = runner({
      listed: JSON.stringify([
        { url: "https://github.com/o/r/pull/10", state: "CLOSED", isDraft: false },
        { url: "https://github.com/o/r/pull/9", state: "OPEN", isDraft: true },
      ]),
    });
    expect(await findUpstreamPr(request, run)).toEqual({
      kind: "pr",
      url: "https://github.com/o/r/pull/9",
      state: "draft",
    });
  });

  it.each([
    ["MERGED", "merged"],
    ["CLOSED", "closed"],
  ])("maps a %s PR to %s", async (state, expected) => {
    const run = runner({
      listed: JSON.stringify([{ url: "https://github.com/o/r/pull/9", state, isDraft: false }]),
    });
    expect(await findUpstreamPr(request, run)).toMatchObject({ kind: "pr", state: expected });
  });

  it.each([
    ["the upstream has the local name", { merge: "refs/heads/bb/dev-1-frontend" }],
    ["there is no upstream", { merge: null }],
    ["HEAD is detached", { branch: "HEAD" }],
  ])("does not ask GitHub when %s", async (_name, options) => {
    const run = runner(options);
    expect(await findUpstreamPr(request, run)).toEqual({ kind: "none" });
    expect(run).not.toHaveBeenCalledWith("gh", expect.anything(), expect.anything());
  });

  it("reports none when GitHub has no PR for the upstream", async () => {
    expect(await findUpstreamPr(request, runner())).toEqual({ kind: "none" });
  });

  it("reports a gh failure", async () => {
    expect(
      await findUpstreamPr(request, runner({ listed: new Error("gh: not logged in") })),
    ).toEqual({
      kind: "error",
      message: "gh: not logged in",
    });
  });
});
