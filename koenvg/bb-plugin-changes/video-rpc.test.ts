import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import plugin from "./server";

const head = "1111111111111111111111111111111111111111";
const base = "2222222222222222222222222222222222222222";
const file = {
  path: "new.mp4",
  previousPath: "old.mp4",
  status: "renamed",
  binary: true,
  additions: 0,
  deletions: 0,
  loadMode: "auto",
};
const ready = { kind: "ready", mime: "video/mp4", content: "AAAAAGZ0eXBpc29t", sizeBytes: 12 };
const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(disposers.splice(0).map((dispose) => dispose()));
});
async function setup() {
  const read = vi.fn(async () => ready);
  const { bb, harness } = createFakePluginHost({
    pluginId: "changes",
    sdk: {
      threads: {
        get: async ({ threadId }) => makeThreadResponse({ id: threadId, environmentId: "env-1" }),
      },
      environments: {
        get: async () => ({ hostId: "remote-host", path: "/remote/worktree" }) as never,
      },
    },
    experimental_callHostRpc: read,
  });
  await plugin(bb);
  disposers.push(() => harness.dispose());
  return { harness, read };
}
describe("Changes video public RPC", () => {
  it.each([
    ["all", "before", { kind: "commit", sha: base, firstParent: false }, "old.mp4"],
    ["all", "after", { kind: "working-tree" }, "new.mp4"],
    ["uncommitted", "before", { kind: "commit", sha: head, firstParent: false }, "old.mp4"],
    ["uncommitted", "after", { kind: "working-tree" }, "new.mp4"],
    ["branch_committed", "before", { kind: "commit", sha: base, firstParent: false }, "old.mp4"],
    ["branch_committed", "after", { kind: "commit", sha: head, firstParent: false }, "new.mp4"],
    ["commit", "before", { kind: "commit", sha: base, firstParent: true }, "old.mp4"],
    ["commit", "after", { kind: "commit", sha: base, firstParent: false }, "new.mp4"],
  ])("pins %s %s on the actual host", async (kind, side, revision, path) => {
    const { harness } = await setup();
    expect(
      await harness.behavior.callRpc("getVideo", {
        threadId: "thread",
        basis: {
          environmentId: "env-1",
          headSha: head,
          mergeBaseRef: base,
          target: kind === "commit" ? { kind, sha: base } : { kind },
        },
        file,
        side,
      }),
    ).toEqual(ready);
    expect(
      harness.experimental_hostRpcCalls.map(({ method, input, hostId }) => ({
        method,
        input,
        hostId,
      })),
    ).toEqual([
      {
        method: "readVideo",
        input: { root: "/remote/worktree", path, revision },
        hostId: "remote-host",
      },
    ]);
    expect(harness.inspection.sdk.callsTo("environments.diffFile")).toHaveLength(0);
  });
  it.each([
    ["added", "before"],
    ["untracked", "before"],
    ["deleted", "after"],
  ])("does not read absent %s %s", async (status, side) => {
    const { harness, read } = await setup();
    expect(
      await harness.behavior.callRpc("getVideo", {
        threadId: "thread",
        basis: {
          environmentId: "env-1",
          headSha: head,
          mergeBaseRef: base,
          target: { kind: "all" },
        },
        file: { ...file, status },
        side,
      }),
    ).toEqual({ kind: "absent" });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects stale environments and unsafe paths before host access", async () => {
    const { harness, read } = await setup();
    for (const [environmentId, path] of [
      ["other", "new.mp4"],
      ["env-1", "../secret.mp4"],
    ]) {
      expect(
        await harness.behavior.callRpc("getVideo", {
          threadId: "thread",
          basis: { environmentId, headSha: head, mergeBaseRef: base, target: { kind: "all" } },
          file: { ...file, path },
          side: "after",
        }),
      ).toMatchObject({ kind: "error" });
    }
    expect(read).not.toHaveBeenCalled();
  });
});
