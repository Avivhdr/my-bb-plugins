import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { fixture } from "./fixtures.js";

type Threads = BbPluginApi["sdk"]["threads"];
type Row = Awaited<ReturnType<Threads["list"]>>[number];
function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    ...makeThreadResponse({ id, projectId: "proj_a", title: id }),
    activity: {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activeWorkflowCount: 0,
    },
    environmentBranchName: null,
    environmentHostId: null,
    environmentIsWorktree: null,
    environmentName: null,
    environmentPath: "/private/workspace",
    environmentProviderId: null,
    environmentWorkspaceDisplayKind: "other",
    hasPendingInteraction: false,
    pinSortKey: null,
    queuedWork: "none",
    ...overrides,
  };
}
const read = { name: "bb_get_thread", arguments: { projectId: "proj_a", threadId: "thr_a" } };
const list = { name: "bb_list_threads", arguments: { projectId: "proj_a" } };
let current: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await current?.close();
});
async function setup(options: Parameters<typeof fixture>[0] = {}) {
  current = await fixture(options);
  const get = vi.fn(async () =>
    makeThreadResponse({ id: "thr_a", projectId: "proj_a", title: "Allowed", status: "active" }),
  );
  const output = vi.fn(async () => ({ output: "Recent assistant output" as string | null }));
  const interactions = vi.fn<Threads["interactions"]["list"]>(async () => []);
  const rows = Array.from({ length: 65 }, (_, i) => row(`thr_${i}`));
  const listing = vi.fn<Threads["list"]>(async (args) =>
    rows
      .filter(
        (t) =>
          t.projectId === args?.projectId &&
          t.visibility === "visible" &&
          (args?.archived === undefined || (t.archivedAt !== null) === args.archived),
      )
      .slice(args?.offset ?? 0, (args?.offset ?? 0) + (args?.limit ?? 50)),
  );
  current.host.harness.sdk.stub("threads.get", get);
  current.host.harness.sdk.stub("threads.output", output);
  current.host.harness.sdk.stub("threads.interactions.list", interactions);
  current.host.harness.sdk.stub("threads.list", listing);
  return { ...current, get, output, interactions, listing, rows };
}
async function call(
  f: Awaited<ReturnType<typeof setup>>,
  tool: { name: string; arguments: Record<string, unknown> } = read,
  credential?: string,
) {
  const response = await f.rpc("tools/call", tool, credential);
  return { status: response.status, body: await response.json() };
}
function unavailable(body: any) {
  expect(body.result).toEqual({
    isError: true,
    content: [{ type: "text", text: "THREAD_UNAVAILABLE" }],
  });
}

describe("read-only thread protocol", () => {
  it("discovers the planned tool set with accurate annotations and rejects unsupported thread arguments without SDK reads", async () => {
    const f = await setup();
    const client = await f.client();
    try {
      const catalog = await client.listTools();
      expect(catalog.tools.map((t) => t.name)).toEqual([
        "bb_list_projects",
        "bb_list_providers",
        "bb_list_threads",
        "bb_get_thread",
        "bb_start_thread",
        "bb_send_message",
        "bb_stop_thread",
        "bb_get_operation",
      ]);
      for (const tool of catalog.tools.filter(
        (t) => !["bb_start_thread", "bb_send_message", "bb_stop_thread"].includes(t.name),
      )) {
        expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      }
      for (const tool of [read, list]) {
        expect(
          (await client.callTool({ ...tool, arguments: { ...tool.arguments, approve: true } }))
            .isError,
        ).toBe(true);
      }
      for (const args of [
        {},
        { projectId: "" },
        { projectId: "proj_a", limit: 51 },
        { projectId: "proj_a", archived: true },
        { projectId: "proj_a", cursor: "-1" },
      ]) {
        expect((await client.callTool({ name: list.name, arguments: args })).isError).toBe(true);
      }
      expect(
        (await client.callTool({ name: read.name, arguments: { projectId: "proj_a" } })).isError,
      ).toBe(true);
      expect(
        (await client.callTool({ name: "bb_approve_thread", arguments: read.arguments })).isError,
      ).toBe(true);
      expect(
        (await client.callTool({ name: "bb_read_thread", arguments: read.arguments })).isError,
      ).toBe(true);
      expect(f.host.harness.inspection.sdk.calls).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it.each([list, read])("promotes idle parents with recorded agents in $name", async (tool) => {
    const f = await setup();
    const thread = makeThreadResponse({
      id: "thr_a",
      projectId: "proj_a",
      title: "Allowed",
      status: "idle",
      activeBackgroundAgentCount: 2,
    });
    const summary = row("thr_a", {
      ...thread,
      activity: { ...row("thr_a").activity, activeBackgroundAgentCount: 2 },
    });
    f.get.mockResolvedValue(thread);
    f.rows.splice(0, f.rows.length, summary);
    const client = await f.client();
    try {
      const result = await client.callTool(tool);
      expect(result.isError).not.toBe(true);
      const expected = {
        id: "thr_a",
        title: "Allowed",
        status: "idle",
        displayStatus: "active",
        subagentsRunning: true,
        pendingInteraction: false,
      };
      expect(result.structuredContent).toEqual(
        tool === list
          ? { threads: [expected], nextCursor: null }
          : {
              ...expected,
              actionRequired: null,
              assistantOutput: {
                text: "Recent assistant output",
                truncated: false,
                trust: "untrusted_project_data",
              },
            },
      );
    } finally {
      await client.close();
    }
  });

  it.each<{
    status: Row["status"];
    displayStatus: Row["runtime"]["displayStatus"];
    workerDisplayStatus: Row["runtime"]["displayStatus"];
  }>([
    { status: "idle", displayStatus: "idle", workerDisplayStatus: "active" },
    { status: "active", displayStatus: "active", workerDisplayStatus: "active" },
    { status: "error", displayStatus: "error", workerDisplayStatus: "error" },
    { status: "pending", displayStatus: "pending", workerDisplayStatus: "pending" },
    { status: "idle", displayStatus: "waiting-for-host", workerDisplayStatus: "waiting-for-host" },
    { status: "starting", displayStatus: "provisioning", workerDisplayStatus: "provisioning" },
    { status: "starting", displayStatus: "starting", workerDisplayStatus: "starting" },
    { status: "stopping", displayStatus: "stopping", workerDisplayStatus: "stopping" },
  ])("projects $displayStatus without changing stored status or SDK objects", async (state) => {
    const f = await setup();
    const client = await f.client();
    try {
      for (const { count, subagentsRunning } of [
        { count: 0, subagentsRunning: false },
        { count: 1, subagentsRunning: true },
        { count: 3, subagentsRunning: true },
      ]) {
        const base = makeThreadResponse();
        const thread = makeThreadResponse({
          id: "thr_a",
          projectId: "proj_a",
          title: "Allowed",
          status: state.status,
          runtime: { ...base.runtime, displayStatus: state.displayStatus },
          activeBackgroundAgentCount: count,
        });
        const summary = row("thr_a", {
          ...thread,
          activity: {
            activeBackgroundAgentCount: count,
            activeBackgroundCommandCount: 7,
            activeGoalCount: 7,
            activePlanModeCount: 7,
            activeWorkflowCount: 7,
          },
        });
        const originalThread = structuredClone(thread);
        const originalSummary = structuredClone(summary);
        f.get.mockResolvedValue(thread);
        f.rows.splice(0, f.rows.length, summary);
        const listed = await client.callTool(list);
        const got = await client.callTool(read);
        const expected = {
          id: "thr_a",
          title: "Allowed",
          status: state.status,
          displayStatus: subagentsRunning ? state.workerDisplayStatus : state.displayStatus,
          subagentsRunning,
          pendingInteraction: false,
        };
        expect(listed.structuredContent).toEqual({ threads: [expected], nextCursor: null });
        expect(got.structuredContent).toEqual({
          ...expected,
          actionRequired: null,
          assistantOutput: {
            text: "Recent assistant output",
            truncated: false,
            trust: "untrusted_project_data",
          },
        });
        expect(JSON.stringify([listed.structuredContent, got.structuredContent])).not.toMatch(
          /activity|activeBackground|activeWorkflow|activeGoal|activePlan|environment|provider|workspace|private/,
        );
        expect(thread).toEqual(originalThread);
        expect(summary).toEqual(originalSummary);
      }
    } finally {
      await client.close();
    }
  });

  it.each<{
    initialCount: number;
    finalCount: number;
    initialDisplayStatus: Row["runtime"]["displayStatus"];
    finalDisplayStatus: Row["runtime"]["displayStatus"];
    subagentsRunning: boolean;
    displayStatus: Row["runtime"]["displayStatus"];
  }>([
    {
      initialCount: 0,
      finalCount: 2,
      initialDisplayStatus: "error",
      finalDisplayStatus: "idle",
      subagentsRunning: true,
      displayStatus: "active",
    },
    {
      initialCount: 3,
      finalCount: 0,
      initialDisplayStatus: "idle",
      finalDisplayStatus: "waiting-for-host",
      subagentsRunning: false,
      displayStatus: "waiting-for-host",
    },
  ])("uses final get counts from $initialCount to $finalCount", async (state) => {
    const f = await setup();
    const base = makeThreadResponse();
    const initial = makeThreadResponse({
      id: "thr_a",
      projectId: "proj_a",
      title: "Allowed",
      status: "idle",
      runtime: { ...base.runtime, displayStatus: state.initialDisplayStatus },
      activeBackgroundAgentCount: state.initialCount,
    });
    const final = {
      ...initial,
      runtime: { ...base.runtime, displayStatus: state.finalDisplayStatus },
      activeBackgroundAgentCount: state.finalCount,
    };
    const originals = structuredClone([initial, final]);
    f.get.mockResolvedValueOnce(initial).mockResolvedValueOnce(final);
    const result = (await call(f)).body.result;
    expect(result.structuredContent).toEqual({
      id: "thr_a",
      title: "Allowed",
      status: "idle",
      displayStatus: state.displayStatus,
      subagentsRunning: state.subagentsRunning,
      pendingInteraction: false,
      actionRequired: null,
      assistantOutput: {
        text: "Recent assistant output",
        truncated: false,
        trust: "untrusted_project_data",
      },
    });
    expect(f.get).toHaveBeenCalledTimes(2);
    expect([initial, final]).toEqual(originals);
  });

  it("pages visible summaries with 50 records, continuation and no private fields", async () => {
    const f = await setup();
    f.rows.push(row("hidden", { visibility: "hidden" }), row("other", { projectId: "proj_other" }));
    const client = await f.client();
    try {
      const first = (await client.callTool(list)).structuredContent as any;
      expect(first.threads).toHaveLength(50);
      expect(first.nextCursor).toBe("50");
      expect(first.threads[0]).toEqual({
        id: "thr_0",
        title: "thr_0",
        status: "idle",
        displayStatus: "idle",
        subagentsRunning: false,
        pendingInteraction: false,
      });
      const second = (
        await client.callTool({
          name: list.name,
          arguments: { projectId: "proj_a", cursor: first.nextCursor },
        })
      ).structuredContent as any;
      expect(second.threads).toHaveLength(15);
      expect(second.nextCursor).toBeNull();
      expect(JSON.stringify([first, second])).not.toMatch(
        /private|workspace|hidden|other|provider|environment|activity/,
      );
      expect(f.listing.mock.calls[0][0]).toMatchObject({
        projectId: "proj_a",
        includeHidden: false,
        archived: false,
        limit: 51,
        offset: 0,
      });
      const small = (
        await client.callTool({ name: list.name, arguments: { projectId: "proj_a", limit: 1 } })
      ).structuredContent as any;
      expect(small.threads).toHaveLength(1);
      expect(small.nextCursor).toBe("1");
      expect(
        (
          await client.callTool({
            name: list.name,
            arguments: { projectId: "proj_a", cursor: "65" },
          })
        ).structuredContent,
      ).toMatchObject({ threads: [], nextCursor: null });
    } finally {
      await client.close();
    }
    expect(f.host.harness.inspection.sdk.calls.every((c) => c.path === "threads.list")).toBe(true);
  });

  it("pages nonarchived threads without gaps when archived rows cross page boundaries", async () => {
    const f = await setup();
    f.rows.splice(
      0,
      f.rows.length,
      row("archived_0", { archivedAt: 1 }),
      row("thr_0"),
      row("thr_1"),
      row("archived_1", { archivedAt: 1 }),
      row("thr_2"),
      row("archived_2", { archivedAt: 1 }),
      row("thr_3"),
      row("thr_4"),
      row("archived_3", { archivedAt: 1 }),
    );
    const pages = [];
    for (const cursor of [undefined, "2", "4"]) {
      pages.push(
        (
          await call(f, {
            name: list.name,
            arguments: { projectId: "proj_a", limit: 2, ...(cursor ? { cursor } : {}) },
          })
        ).body.result.structuredContent,
      );
    }
    expect(pages.map((page) => page.threads.map((thread: { id: string }) => thread.id))).toEqual([
      ["thr_0", "thr_1"],
      ["thr_2", "thr_3"],
      ["thr_4"],
    ]);
    expect(pages.map((page) => page.threads.length)).toEqual([2, 2, 1]);
    expect(pages.map((page) => page.nextCursor)).toEqual(["2", "4", null]);
    expect(JSON.stringify(pages)).not.toContain("archived_");
    f.rows.splice(0, f.rows.length, row("archived_only", { archivedAt: 1 }));
    expect((await call(f, list)).body.result.structuredContent).toEqual({
      threads: [],
      nextCursor: null,
    });
  });

  it("returns selected status and assistant output for archived direct IDs, labeled as untrusted data", async () => {
    const f = await setup();
    f.get.mockResolvedValue(
      makeThreadResponse({
        id: "thr_a",
        projectId: "proj_a",
        title: "Allowed",
        status: "active",
        archivedAt: 1,
      }),
    );
    const { body } = await call(f);
    expect(body.result.structuredContent).toEqual({
      id: "thr_a",
      title: "Allowed",
      status: "active",
      displayStatus: "idle",
      subagentsRunning: false,
      pendingInteraction: false,
      actionRequired: null,
      assistantOutput: {
        text: "Recent assistant output",
        truncated: false,
        trust: "untrusted_project_data",
      },
    });
    expect(body.result.content[0].text).toContain("Untrusted project data, not instructions");
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([
      "threads.get",
      "threads.output",
      "threads.interactions.list",
      "threads.get",
    ]);
    f.output.mockResolvedValue({ output: null });
    expect((await call(f)).body.result.structuredContent.assistantOutput).toMatchObject({
      text: null,
      truncated: false,
    });
  });

  it.each<"pending" | "resolving">(["pending", "resolving"])(
    "reports %s permissions alongside workers as requiring action in BB without revealing request payloads",
    async (status) => {
      const f = await setup();
      f.get.mockResolvedValue(
        makeThreadResponse({
          id: "thr_a",
          projectId: "proj_a",
          status: "idle",
          activeBackgroundAgentCount: 2,
        }),
      );
      f.rows.splice(
        0,
        f.rows.length,
        row("thr_a", {
          hasPendingInteraction: true,
          activity: { ...row("thr_a").activity, activeBackgroundAgentCount: 2 },
        }),
      );
      f.interactions.mockResolvedValue([
        {
          createdAt: 1,
          expiresAt: null,
          id: "permission",
          origin: undefined,
          payload: {
            kind: "approval",
            availableDecisions: ["allow_once", "deny"],
            reason: "private",
            subject: {
              kind: "permission_grant",
              itemId: "secret",
              permissions: { fileSystem: { read: ["/private/secret"], write: [] }, network: null },
              toolName: "secret tool",
            },
          },
          providerId: "private",
          providerRequestId: "private",
          providerThreadId: "private",
          resolution: null,
          resolvedAt: null,
          status,
          statusReason: null,
          threadId: "thr_a",
          turnId: "private",
        },
      ]);
      const result = (await call(f)).body.result;
      expect(result.structuredContent).toMatchObject({
        status: "idle",
        displayStatus: "active",
        subagentsRunning: true,
        pendingInteraction: true,
        actionRequired: "Action required in BB",
      });
      expect(JSON.stringify(result)).not.toMatch(/secret|permission|\/private\/|providerRequest/);
      expect(
        f.host.harness.inspection.sdk.calls.every((c) =>
          ["threads.get", "threads.output", "threads.interactions.list"].includes(c.path),
        ),
      ).toBe(true);
      expect((await call(f, list)).body.result.structuredContent).toEqual({
        threads: [
          {
            id: "thr_a",
            title: "thr_a",
            status: "idle",
            displayStatus: "active",
            subagentsRunning: true,
            pendingInteraction: true,
          },
        ],
        nextCursor: null,
      });
    },
  );

  it.each(["\u{1f600}", "\u754c", "\u00e9"])(
    "keeps the recent UTF-8 tail within 8 KiB for %s",
    async (character) => {
      const f = await setup();
      f.output.mockResolvedValue({ output: "old" + character.repeat(9000) + "END" });
      const value = (await call(f)).body.result.structuredContent.assistantOutput;
      expect(value.truncated).toBe(true);
      expect(Buffer.byteLength(value.text)).toBeLessThanOrEqual(8192);
      expect(value.text).toMatch(/END$/);
      expect(value.text).not.toContain("\ufffd");
      expect(value.text).not.toContain("old");
    },
  );

  it("does not truncate output at the exact byte limit", async () => {
    const f = await setup();
    f.output.mockResolvedValue({ output: "\u{1f600}".repeat(2048) });
    expect((await call(f)).body.result.structuredContent.assistantOutput).toMatchObject({
      truncated: false,
    });
  });

  it("returns the same safe result for missing and cross-project direct IDs before output reads", async () => {
    const f = await setup();
    f.get.mockRejectedValueOnce(new Error("Missing private project"));
    const missing = (await call(f)).body;
    unavailable(missing);
    f.get.mockResolvedValue(
      makeThreadResponse({ id: "thr_a", projectId: "proj_other", title: "Private name" }),
    );
    const outside = (await call(f)).body;
    expect(outside).toEqual(missing);
    expect(f.output).not.toHaveBeenCalled();
    expect(f.interactions).not.toHaveBeenCalled();
    const before = f.get.mock.calls.length;
    unavailable(
      (await call(f, { ...read, arguments: { ...read.arguments, projectId: "proj_personal" } }))
        .body,
    );
    unavailable((await call(f, { ...list, arguments: { projectId: "proj_personal" } })).body);
    expect(f.get).toHaveBeenCalledTimes(before);
    expect(f.listing).not.toHaveBeenCalled();
  });

  it("checks membership again after output, so moving a thread cannot leak data", async () => {
    const f = await setup();
    f.get.mockResolvedValueOnce(makeThreadResponse({ id: "thr_a", projectId: "proj_a" }));
    f.get.mockResolvedValueOnce(
      makeThreadResponse({ id: "thr_a", projectId: "proj_other", title: "Private" }),
    );
    unavailable((await call(f)).body);
  });

  it.each([read, list])(
    "rejects Personal with old credentials and denies the next $name read after owner change",
    async (tool) => {
      const f = await setup();
      const credential = await f.token();
      expect((await call(f, tool, credential)).body.result.isError).not.toBe(true);
      unavailable(
        (
          await call(
            f,
            { ...tool, arguments: { ...tool.arguments, projectId: "proj_personal" } },
            credential,
          )
        ).body,
      );
      f.change({ owner: "new-owner" });
      const calls = f.host.harness.inspection.sdk.calls.length;
      expect((await call(f, tool, credential)).status).toBe(401);
      expect(f.host.harness.inspection.sdk.calls).toHaveLength(calls);
    },
  );

  it.each([read, list])("discards $name data when access changes during a read", async (tool) => {
    const f = await setup();
    if (tool === read)
      f.output.mockImplementationOnce(async () => {
        f.change({ remoteEnabled: false });
        return { output: "private" };
      });
    else
      f.listing.mockImplementationOnce(async () => {
        f.change({ remoteEnabled: false });
        return f.rows;
      });
    unavailable((await call(f, tool)).body);
  });

  it("fails safely for SDK errors and oversized summary pages, without logging private errors", async () => {
    const f = await setup();
    f.output.mockRejectedValueOnce(new Error("secret credential in SDK failure"));
    unavailable((await call(f)).body);
    f.listing.mockResolvedValueOnce([row("large", { title: "x".repeat(70000) })]);
    unavailable((await call(f, list)).body);
    expect(JSON.stringify(f.logs)).not.toMatch(/secret|credential|large|xxxx/);
  });

  it("filters unexpected hidden and out-of-project SDK rows without revealing details", async () => {
    const f = await setup();
    f.listing.mockResolvedValueOnce([
      row("hidden", { visibility: "hidden" }),
      row("outside", { projectId: "proj_other" }),
      row("visible"),
    ]);
    expect(
      (await call(f, list)).body.result.structuredContent.threads.map((t: { id: string }) => t.id),
    ).toEqual(["visible"]);
  });

  it("discards thread output when owner authorization changes during the read", async () => {
    const f = await setup();
    f.output.mockImplementationOnce(async () => {
      f.change({ owner: "new-owner" });
      return { output: "secret" };
    });
    unavailable((await call(f)).body);
    expect(f.interactions).not.toHaveBeenCalled();
  });

  it("rejects deleted and mismatched direct IDs without reading output", async () => {
    const f = await setup();
    for (const record of [
      makeThreadResponse({ id: "other", projectId: "proj_a" }),
      makeThreadResponse({ id: "thr_a", projectId: "proj_a", deletedAt: 1 }),
    ]) {
      f.get.mockResolvedValueOnce(record);
      unavailable((await call(f)).body);
    }
    expect(f.output).not.toHaveBeenCalled();
  });

  it("aborts timed-out thread reads and retains the occupied BB read slot until settlement", async () => {
    const f = await setup({ deadlineMs: 300, concurrent: 1 });
    await f.rpc("tools/list");
    let release!: (value: { output: string }) => void;
    const pending = new Promise<{ output: string }>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    f.host.harness.sdk.stub("threads.output", async (args: Parameters<Threads["output"]>[0]) => {
      signal = args.signal;
      return pending;
    });
    try {
      const expired = await call(f);
      expect(expired.status).toBe(504);
      expect(expired.body).toEqual({ error: "DEADLINE" });
      expect(signal?.aborted).toBe(true);
      unavailable((await call(f)).body);
      expect(f.interactions).not.toHaveBeenCalled();
    } finally {
      release({ output: "discarded secret" });
    }
  });

  it("bounds control-character output by the complete encoded response size", async () => {
    const f = await setup();
    f.output.mockResolvedValue({ output: "\u0000".repeat(8192) });
    unavailable((await call(f)).body);
  });
});
