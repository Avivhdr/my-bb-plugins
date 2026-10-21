import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture } from "./fixtures.js";
import { loopbackFetch } from "./fixtures.js";
import type { operationControl } from "../operations.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const input = {
  projectId: "proj_a",
  prompt: "Synthetic only: no live agent",
  operationKey: "fault-1",
};
const defaults = {
  providerId: "fixture",
  model: "fixture-model",
  permissionMode: "accept-edits" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "default",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(options: Pick<Parameters<typeof operationControl>[0], "limits" | "now"> = {}) {
  f = await fixture(
    {},
    { limits: { responseWaitMs: 50, sdkDeadlineMs: 500, ...options.limits }, now: options.now },
  );
  f.change({ controlEnabled: true });
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
    makeThreadResponse({ id: "thr_started", projectId: "proj_a", status: "pending" }),
  );
  const get = vi.fn<typeof f.host.bb.sdk.threads.get>(async () =>
    makeThreadResponse({ id: "thr_started", projectId: "proj_a" }),
  );
  const readDefaults = vi.fn<typeof f.host.bb.sdk.projects.defaultExecutionOptions>(
    async () => defaults,
  );
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("threads.get", get);
  return { spawn, get, readDefaults, credential: await f.token({ scope: "bb.read bb.control" }) };
}
async function call(name: string, args: object, credential?: string) {
  const response = await f.rpc("tools/call", { name, arguments: args }, credential);
  return { status: response.status, body: await response.json() };
}
async function start(credential: string, changes: object = {}) {
  return (await call("bb_start_thread", { ...input, ...changes }, credential)).body.result;
}
async function poll(operationId: string, credential?: string) {
  return (await call("bb_get_operation", { operationId }, credential)).body.result;
}
function unavailable(result: any) {
  expect(result).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "OPERATION_UNAVAILABLE" }],
  });
  expect(result.structuredContent).toBeUndefined();
}

describe("authenticated start safety", () => {
  it("advertises honest write risks and read-only status in the MCP catalog", async () => {
    await setup();
    const client = await f.client();
    try {
      const tools = (await client.listTools()).tools;
      expect(tools.map((t) => t.name)).toEqual([
        "bb_list_projects",
        "bb_list_providers",
        "bb_list_threads",
        "bb_get_thread",
        "bb_start_thread",
        "bb_send_message",
        "bb_stop_thread",
        "bb_get_operation",
      ]);
      expect(tools[4].annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: true,
        idempotentHint: true,
      });
      expect(tools[4].description).toMatch(/external actions.*provider costs/);
      expect(
        tools.find((tool) => tool.name === "bb_get_operation")!.annotations?.readOnlyHint,
      ).toBe(true);
    } finally {
      await client.close();
    }
  });

  it.each([
    { prompt: " " },
    { prompt: "é".repeat(17000) },
    { operationKey: "" },
    { operationKey: "bad key" },
    { projectId: "" },
    { title: " " },
    { permissionMode: "full" },
    { environment: { type: "host" } },
    { model: "override" },
    { credentials: "secret" },
    { machineId: "host_private" },
    { parentThreadId: "thr_private" },
    { filesystem: "/private" },
    { pluginMetadata: {} },
  ])("rejects invalid or privileged start input without any BB call: %j", async (changes) => {
    const { spawn, readDefaults, credential } = await setup();
    expect((await start(credential, changes)).isError).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    expect(readDefaults).not.toHaveBeenCalled();
  });

  it("denies missing control scope, disabled control, Personal project and invalid OAuth without a mutation", async () => {
    const { spawn, readDefaults, credential } = await setup();
    unavailable(await start(await f.token()));
    f.change({ controlEnabled: false });
    unavailable(await start(credential));
    f.change({ controlEnabled: true });
    unavailable(await start(credential, { projectId: "proj_personal" }));
    for (const token of [
      await f.token({ scope: "bb.control" }),
      await f.token({ sub: "stranger" }),
      await f.token({ exp: 1 }),
    ])
      expect((await call("bb_start_thread", input, token)).status).toBeGreaterThanOrEqual(401);
    expect(spawn).not.toHaveBeenCalled();
    expect(readDefaults).not.toHaveBeenCalled();
  });

  it.each([
    { controlEnabled: false },
    { accessPermission: "read-control" as const, authMode: "cloudflare-access" as const },
    { owner: "another-owner" },
    { remoteEnabled: false },
  ])("rechecks live access immediately before dispatch: %j", async (change) => {
    const { spawn, readDefaults, credential } = await setup({
      limits: { responseWaitMs: 2000, sdkDeadlineMs: 5000 },
    });
    const ready = deferred<typeof defaults>();
    readDefaults.mockImplementation(() => ready.promise);
    const submission = start(credential);
    await expect.poll(() => readDefaults.mock.calls.length).toBe(1);
    f.change(change);
    ready.resolve(defaults);
    unavailable(await submission);
    expect(spawn).not.toHaveBeenCalled();
    f.change({
      controlEnabled: true,
      remoteEnabled: true,
      authMode: "bearer-jwt",
      owner: "owner-1",
    });
    expect((await start(credential)).structuredContent.state).toBe("failed");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rechecks token expiry while defaults are pending", async () => {
    const { spawn, readDefaults } = await setup({ limits: { sdkDeadlineMs: 3000 } });
    const ready = deferred<typeof defaults>();
    readDefaults.mockImplementation(() => ready.promise);
    const token = await f.token({
      scope: "bb.read bb.control",
      exp: Math.floor(Date.now() / 1000) + 1,
    });
    await start(token);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    ready.resolve(defaults);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([null, "reject"])(
    "reports a confirmed pre-dispatch default failure without a fallback: %s",
    async (failure) => {
      const { spawn, readDefaults, credential } = await setup();
      readDefaults.mockImplementation(async () => {
        if (failure === "reject") throw new Error("Private BB error");
        return null;
      });
      const result = await start(credential);
      expect(result.structuredContent).toMatchObject({
        state: "failed",
        threadId: null,
        code: "START_NOT_DISPATCHED",
      });
      expect(JSON.stringify(result)).not.toContain("Private BB error");
      readDefaults.mockResolvedValue(defaults);
      expect((await start(credential)).structuredContent.state).toBe("failed");
      expect(spawn).not.toHaveBeenCalled();
    },
  );

  it("preserves project defaults, BB deferment and permission requests without task or approval actions", async () => {
    const { spawn, credential } = await setup();
    const result = await start(credential, { title: "Fixture title" });
    expect(result.structuredContent).toMatchObject({ state: "accepted", threadId: "thr_started" });
    expect(result.structuredContent.meaning).toContain("not complete");
    expect(spawn.mock.calls[0][0]).toMatchObject({
      ...defaults,
      title: "Fixture title",
      environment: { type: "project-default" },
      visibility: "visible",
      pluginMetadata: { operationId: result.structuredContent.operationId },
    });
    expect(Object.keys(spawn.mock.calls[0][0]).sort()).toEqual(
      [
        "environment",
        "model",
        "origin",
        "originPluginId",
        "permissionMode",
        "pluginMetadata",
        "projectId",
        "prompt",
        "providerId",
        "reasoningLevel",
        "serviceTier",
        "title",
        "visibility",
      ].sort(),
    );
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([
      "projects.defaultExecutionOptions",
      "threads.spawn",
      "threads.get",
    ]);
    expect(JSON.stringify(f.logs)).not.toContain(input.prompt);
  });

  it("denies cached results and polls after movement to Personal, thread move, deletion or owner change", async () => {
    const { get, spawn, credential } = await setup();
    const result = await start(credential);
    const operationId = result.structuredContent.operationId;
    get.mockResolvedValue(makeThreadResponse({ id: "thr_started", projectId: "proj_personal" }));
    unavailable(await poll(operationId));
    unavailable(await start(credential));
    get.mockResolvedValue(makeThreadResponse({ id: "thr_started", projectId: "proj_other" }));
    unavailable(await poll(operationId));
    unavailable(await start(credential));
    get.mockResolvedValue(
      makeThreadResponse({ id: "thr_started", projectId: "proj_a", deletedAt: 1 }),
    );
    unavailable(await poll(operationId));
    f.change({ owner: "owner-2" });
    unavailable(await poll(operationId));
    get.mockResolvedValue(makeThreadResponse({ id: "thr_started", projectId: "proj_a" }));
    const other = await start(await f.token({ scope: "bb.read bb.control" }));
    expect(other.structuredContent.operationId).not.toBe(operationId);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("rechecks access after the membership read before returning a cached result", async () => {
    const { get, credential } = await setup();
    const result = await start(credential);
    get.mockImplementation(async () => {
      f.change({ remoteEnabled: false });
      return makeThreadResponse({ id: "thr_started", projectId: "proj_a" });
    });
    unavailable(await poll(result.structuredContent.operationId));
  });

  it("keeps polling available with read scope when local control is disabled", async () => {
    const { credential, spawn } = await setup();
    const result = await start(credential);
    f.change({ controlEnabled: false });
    expect((await poll(result.structuredContent.operationId)).structuredContent.state).toBe(
      "accepted",
    );
    unavailable(await start(credential));
    unavailable(await poll("missing-operation"));
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe("durable outcomes and loss", () => {
  it("reports a deadline as unknown and later records acceptance without retry", async () => {
    const { spawn, credential } = await setup({ limits: { sdkDeadlineMs: 80 } });
    const work = deferred<ReturnType<typeof makeThreadResponse>>();
    spawn.mockImplementation(() => work.promise);
    const result = await start(credential);
    const operationId = result.structuredContent.operationId;
    expect(result.structuredContent.state).toBe("pending");
    await expect
      .poll(async () => (await poll(operationId)).structuredContent.state)
      .toBe("unknown");
    expect((await start(credential)).structuredContent.state).toBe("unknown");
    expect(spawn).toHaveBeenCalledTimes(1);
    work.resolve(makeThreadResponse({ id: "thr_started", projectId: "proj_a" }));
    await expect
      .poll(async () => (await poll(operationId)).structuredContent.state)
      .toBe("accepted");
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("never dispatches after a pre-dispatch deadline", async () => {
    const { readDefaults, spawn, credential } = await setup({ limits: { sdkDeadlineMs: 50 } });
    const ready = deferred<typeof defaults>();
    readDefaults.mockImplementation(() => ready.promise);
    const result = await start(credential);
    await expect
      .poll(async () => (await poll(result.structuredContent.operationId)).structuredContent.state)
      .toBe("failed");
    ready.resolve(defaults);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await start(credential)).structuredContent.state).toBe("failed");
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each(["lost reply", "BB rejection", "SDK deadline"])(
    "does not turn a dispatch error into safe retry: %s",
    async (reason) => {
      const { spawn, credential } = await setup();
      spawn.mockRejectedValue(new Error(reason + " secret"));
      const result = await start(credential);
      expect(result.structuredContent).toMatchObject({ state: "unknown", threadId: null });
      expect(result.structuredContent.meaning).toContain("Inspect BB");
      expect(JSON.stringify(result)).not.toContain("secret");
      expect((await start(credential)).structuredContent.state).toBe("unknown");
      expect(spawn).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])(
    "preserves pending identity across plugin reload/crash without resubmission: crash=%s",
    async (crash) => {
      const { spawn, credential } = await setup({ limits: { sdkDeadlineMs: 100 } });
      const work = deferred<ReturnType<typeof makeThreadResponse>>();
      spawn.mockImplementation(() => work.promise);
      const result = await start(credential);
      const operationId = result.structuredContent.operationId;
      expect(result.structuredContent.state).toBe("pending");
      await f.restart(crash);
      expect((await poll(operationId)).structuredContent.state).toBe("unknown");
      const replacement = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
        makeThreadResponse({ id: "thr_duplicate", projectId: "proj_a" }),
      );
      f.host.harness.sdk.stub("threads.spawn", replacement);
      expect((await start(credential)).structuredContent.state).toBe("unknown");
      work.resolve(makeThreadResponse({ id: "thr_started", projectId: "proj_a" }));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect((await poll(operationId)).structuredContent.state).toBe("unknown");
      expect(spawn).toHaveBeenCalledTimes(1);
      expect(replacement).not.toHaveBeenCalled();
    },
  );

  it("preserves acceptance after a lost HTTP reply and restart", async () => {
    const { credential } = await setup();
    const discarded = await start(credential);
    await f.restart();
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "thr_started", projectId: "proj_a" }),
    );
    const replay = await start(credential);
    expect(replay.structuredContent).toEqual(discarded.structuredContent);
    expect((await poll(replay.structuredContent.operationId)).structuredContent.state).toBe(
      "accepted",
    );
    expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it.each([false, true])(
    "client disconnect does not replay work: dispatched=%s",
    async (dispatched) => {
      const { spawn, readDefaults, credential } = await setup({ limits: { responseWaitMs: 2000 } });
      const work = deferred<ReturnType<typeof makeThreadResponse>>();
      const ready = deferred<typeof defaults>();
      if (dispatched) spawn.mockImplementation(() => work.promise);
      else readDefaults.mockImplementation(() => ready.promise);
      const controller = new AbortController();
      const request = loopbackFetch(f.local + "/mcp", {
        method: "POST",
        signal: controller.signal,
        headers: {
          host: "mcp.example.org",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer " + credential,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "bb_start_thread", arguments: input },
        }),
      }).catch(() => null);
      await expect
        .poll(() => (dispatched ? spawn.mock.calls.length : readDefaults.mock.calls.length))
        .toBe(1);
      controller.abort();
      await request;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const replay = await start(credential);
      expect(replay.structuredContent.state).toBe(dispatched ? "unknown" : "failed");
      const operationId = replay.structuredContent.operationId;
      if (dispatched) {
        work.resolve(makeThreadResponse({ id: "thr_started", projectId: "proj_a" }));
        await expect
          .poll(async () => (await poll(operationId)).structuredContent.state)
          .toBe("accepted");
        expect(spawn).toHaveBeenCalledTimes(1);
      } else {
        ready.resolve(defaults);
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(spawn).not.toHaveBeenCalled();
      }
    },
  );

  it("recovers a claim lost before dispatch as unknown rather than replaying the prompt", async () => {
    const { readDefaults, spawn, credential } = await setup({ limits: { sdkDeadlineMs: 100 } });
    const ready = deferred<typeof defaults>();
    readDefaults.mockImplementation(() => ready.promise);
    const result = await start(credential);
    await f.restart(true);
    expect((await poll(result.structuredContent.operationId)).structuredContent.state).toBe(
      "unknown",
    );
    expect((await start(credential)).structuredContent.state).toBe("unknown");
    ready.resolve(defaults);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(spawn).not.toHaveBeenCalled();
    expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });

  it("retains completed keys for 24 hours and refuses capacity until expiry", async () => {
    let now = 1000000;
    const { spawn, credential } = await setup({ now: () => now, limits: { capacity: 1 } });
    const result = await start(credential);
    now += 24 * 60 * 60 * 1000;
    expect((await start(credential)).structuredContent.operationId).toBe(
      result.structuredContent.operationId,
    );
    expect((await start(credential, { operationKey: "new-key" })).content[0].text).toBe(
      "LEDGER_FULL",
    );
    now++;
    const newResult = await start(credential);
    expect(newResult.structuredContent.operationId).not.toBe(result.structuredContent.operationId);
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it("never evicts unresolved keys, including when capacity is exhausted", async () => {
    let now = 1000000;
    const { spawn, credential } = await setup({ now: () => now, limits: { capacity: 1 } });
    spawn.mockRejectedValue(new Error("Reply lost"));
    const result = await start(credential);
    now += 365 * 24 * 60 * 60 * 1000;
    expect((await start(credential)).structuredContent.operationId).toBe(
      result.structuredContent.operationId,
    );
    expect((await start(credential, { operationKey: "new-key" })).content[0].text).toBe(
      "LEDGER_FULL",
    );
    await f.restart();
    expect((await poll(result.structuredContent.operationId)).structuredContent.state).toBe(
      "unknown",
    );
    expect((await start(credential)).structuredContent.state).toBe("unknown");
    expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  });
  it("refuses a ninth unresolved dispatch without weakening the BB concurrency controls", async () => {
    const { spawn, credential } = await setup();
    const work = deferred<ReturnType<typeof makeThreadResponse>>();
    spawn.mockImplementation(() => work.promise);
    for (let i = 0; i < 8; i++)
      expect((await start(credential, { operationKey: "slot-" + i })).structuredContent.state).toBe(
        "pending",
      );
    expect((await start(credential, { operationKey: "slot-9" })).content[0].text).toBe(
      "OPERATIONS_BUSY",
    );
    expect(spawn).toHaveBeenCalledTimes(8);
    work.resolve(makeThreadResponse({ id: "thr_started", projectId: "proj_a" }));
  });

  it("bounds the start reply even when the membership SDK ignores cancellation", async () => {
    const { get, credential, spawn } = await setup({ limits: { responseWaitMs: 80 } });
    get.mockImplementation(() => new Promise(() => {}));
    const began = Date.now();
    unavailable(await start(credential));
    expect(Date.now() - began).toBeLessThan(800);
    for (let i = 0; i < 8; i++) unavailable(await start(credential));
    expect(get).toHaveBeenCalledTimes(8);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("normalizes IDs and title, preserves prompt text, and conflicts on title changes", async () => {
    const { spawn, credential } = await setup();
    const first = await start(credential, { projectId: " proj_a ", title: " Fixture " });
    const replay = await start(credential, { title: "Fixture" });
    expect(replay.structuredContent).toEqual(first.structuredContent);
    expect((await start(credential, { title: "Other" })).content[0].text).toBe(
      "OPERATION_CONFLICT",
    );
    expect(
      (await start(credential, { title: "Fixture", prompt: " " + input.prompt })).content[0].text,
    ).toBe("OPERATION_CONFLICT");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][0].prompt).toBe(input.prompt);
  });
});
