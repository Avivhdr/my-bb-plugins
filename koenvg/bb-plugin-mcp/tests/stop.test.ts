import { afterEach, expect, it, vi } from "vitest";
import { makeThreadResponse, makeQueueEntry } from "@get-bb/plugin-sdk/testing";
import { fixture, loopbackFetch } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const input = { threadId: "thr_stop", operationKey: "stop-1" };
type Threads = typeof f.host.bb.sdk.threads;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(options: Parameters<typeof fixture>[1] = {}) {
  f = await fixture(
    {},
    {
      limits: { responseWaitMs: 100, sdkDeadlineMs: 600, ...options.limits },
      now: options.now,
    },
  );
  f.change({ controlEnabled: true });
  const get = vi.fn<Threads["get"]>(async () =>
    makeThreadResponse({ id: input.threadId, projectId: "proj_a", status: "active" }),
  );
  const stop = vi.fn<Threads["stop"]>(async () => ({ ok: true }));
  const queue = vi.fn<Threads["queuedMessages"]["list"]>(async () => []);
  const interactions = vi.fn<Threads["interactions"]["list"]>(async () => []);
  f.host.harness.sdk.stub("threads.get", get);
  f.host.harness.sdk.stub("threads.stop", stop);
  f.host.harness.sdk.stub("threads.queuedMessages.list", queue);
  f.host.harness.sdk.stub("threads.interactions.list", interactions);
  return {
    get,
    stop,
    queue,
    interactions,
    credential: await f.token({ scope: "bb.read bb.control" }),
  };
}
async function call(credential?: string, changes: object = {}) {
  return (
    await (
      await f.rpc(
        "tools/call",
        {
          name: "bb_stop_thread",
          arguments: { ...input, ...changes },
        },
        credential,
      )
    ).json()
  ).result;
}
async function poll(operationId: string, credential?: string) {
  return (
    await (
      await f.rpc(
        "tools/call",
        {
          name: "bb_get_operation",
          arguments: { operationId },
        },
        credential,
      )
    ).json()
  ).result;
}
function unavailable(reply: any) {
  expect(reply).toMatchObject({
    isError: true,
    content: [{ type: "text", text: "OPERATION_UNAVAILABLE" }],
  });
  expect(reply.structuredContent).toBeUndefined();
}

it("requests an ordinary active-thread stop once without claiming completed work", async () => {
  const { stop, credential } = await setup({ limits: { responseWaitMs: 4000 } });
  const reply = await call(credential);
  expect(reply.structuredContent).toMatchObject({
    state: "accepted",
    threadId: input.threadId,
    stopRequested: true,
    observation: { status: "active", queuedMessageCount: 0, pendingInteraction: false },
  });
  expect(reply.structuredContent.meaning).toMatch(/not.*complete/);
  expect((await call(credential)).structuredContent).toEqual(reply.structuredContent);
  expect((await poll(reply.structuredContent.operationId)).structuredContent).toEqual(
    reply.structuredContent,
  );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(stop.mock.calls[0][0]).toEqual({ threadId: input.threadId });
  expect(new Set(f.host.harness.inspection.sdk.calls.map((c) => c.path))).toEqual(
    new Set([
      "threads.get",
      "threads.stop",
      "threads.queuedMessages.list",
      "threads.interactions.list",
    ]),
  );
});

it.each(["idle", "error", "stopping", "starting", "pending"] as const)(
  "reports the observed %s state rather than inventing stop completion",
  async (status) => {
    const { get, stop, credential } = await setup();
    get.mockResolvedValue(makeThreadResponse({ id: input.threadId, projectId: "proj_a", status }));
    const reply = await call(credential);
    await expect
      .poll(
        async () =>
          (await poll(reply.structuredContent.operationId)).structuredContent.observation?.status,
      )
      .toBe(status);
    expect(stop).toHaveBeenCalledTimes(1);
  },
);

it("preserves history, remaining queued input and pending permissions through MCP", async () => {
  const { queue, interactions, credential } = await setup();
  const queued = makeQueueEntry({
    threadId: input.threadId,
    waitingOn: { kind: "interaction" },
    content: [{ type: "text", text: "Private queued instruction", mentions: [] }],
  });
  queue.mockResolvedValue([queued]);
  const approval: Awaited<ReturnType<Threads["interactions"]["list"]>>[number] = {
    createdAt: 1,
    expiresAt: null,
    id: "approval",
    origin: undefined,
    payload: {
      kind: "approval" as const,
      availableDecisions: ["allow_once", "deny"],
      reason: "Private permission",
      subject: {
        kind: "permission_grant" as const,
        itemId: "secret",
        permissions: { fileSystem: { read: ["/private/secret"], write: [] }, network: null },
        toolName: "secret tool",
      },
    },
    providerId: "fixture",
    providerRequestId: "secret",
    providerThreadId: "secret",
    resolution: null,
    resolvedAt: null,
    status: "pending" as const,
    statusReason: null,
    threadId: input.threadId,
    turnId: "private",
  };
  interactions.mockResolvedValue([approval]);
  f.host.harness.sdk.stub("threads.output", async () => ({ output: "Existing history" }));
  const read = async () =>
    (
      await (
        await f.rpc("tools/call", {
          name: "bb_get_thread",
          arguments: { projectId: "proj_a", threadId: input.threadId },
        })
      ).json()
    ).result.structuredContent;
  const before = await read();
  const reply = await call(credential);
  await expect
    .poll(
      async () => (await poll(reply.structuredContent.operationId)).structuredContent.observation,
    )
    .toEqual({
      status: "active",
      queuedMessageCount: 1,
      pendingInteraction: true,
    });
  expect(await read()).toEqual(before);
  expect(before.assistantOutput.text).toBe("Existing history");
  expect(before.pendingInteraction).toBe(true);
  expect(queued.content[0]).toMatchObject({ text: "Private queued instruction" });
  expect(approval.status).toBe("pending");
  expect(JSON.stringify(reply)).not.toMatch(/Private|secret|\/private/);
  expect(
    f.host.harness.inspection.sdk.calls.every((c) =>
      [
        "threads.get",
        "threads.output",
        "threads.interactions.list",
        "threads.queuedMessages.list",
        "threads.stop",
      ].includes(c.path),
    ),
  ).toBe(true);
});

it("exposes only the planned tools and marks stop as a write", async () => {
  await setup();
  const client = await f.client();
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "bb_get_operation",
      "bb_get_thread",
      "bb_list_projects",
      "bb_list_providers",
      "bb_list_threads",
      "bb_send_message",
      "bb_start_thread",
      "bb_stop_thread",
    ]);
    const stop = tools.find((t) => t.name === "bb_stop_thread")!;
    expect(stop.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(stop.description).toMatch(/does not delete queued input or approve/);
  } finally {
    await client.close();
  }
  expect(f.host.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
});

it.each([
  { threadId: "" },
  { threadId: "x".repeat(201) },
  { operationKey: "" },
  { operationKey: "bad key" },
  { operationKey: "x".repeat(129) },
  { projectId: "proj_a" },
  { deleteQueue: true },
  { permissionMode: "full" },
  { decision: "allow_once" },
  { mode: "force" },
  { signal: {} },
  { message: "override" },
])("rejects invalid or extra fields before a BB call: %j", async (changes) => {
  const { get, stop, credential } = await setup();
  expect((await call(credential, changes)).isError).toBe(true);
  expect(get).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

it.each(["bb.read", "bb.control", ""])("denies missing scope: %s", async (scope) => {
  const { get, stop } = await setup();
  const reply = await f.rpc(
    "tools/call",
    { name: "bb_stop_thread", arguments: input },
    await f.token({ scope }),
  );
  if (scope === "bb.read") unavailable((await reply.json()).result);
  else expect(reply.status).toBe(403);
  expect(get).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();
});

it.each(["missing", "outside", "projectless", "deleted", "wrong-id"])(
  "direct IDs cannot bypass thread access: %s",
  async (kind) => {
    const { get, stop, credential } = await setup();
    if (kind === "missing") get.mockRejectedValue(new Error("Private missing detail"));
    else
      get.mockResolvedValue(
        makeThreadResponse({
          id: kind === "wrong-id" ? "thr_other" : input.threadId,
          projectId: kind === "outside" ? "proj_personal" : kind === "projectless" ? "" : "proj_a",
          deletedAt: kind === "deleted" ? 1 : null,
        }),
      );
    const reply = await call(credential);
    unavailable(reply);
    expect(JSON.stringify(reply)).not.toMatch(/Private|proj_personal|thr_other/);
    expect(stop).not.toHaveBeenCalled();
  },
);

it.each(["mode", "control", "owner", "remote", "move", "expiry"])(
  "rechecks policy and membership immediately before stop: %s",
  async (kind) => {
    const { get, stop, credential } = await setup();
    let reads = 0;
    get.mockImplementation(async () => {
      if (++reads === 2) {
        if (kind === "mode") f.change({ authMode: "cloudflare-access" });
        if (kind === "control") f.change({ controlEnabled: false });
        if (kind === "owner") f.change({ owner: "other" });
        if (kind === "remote") f.change({ remoteEnabled: false });
        if (kind === "expiry") vi.spyOn(Date, "now").mockReturnValue(Date.now() + 600000);
      }
      return makeThreadResponse({
        id: input.threadId,
        projectId: reads >= 2 && kind === "move" ? "proj_elsewhere" : "proj_a",
      });
    });
    try {
      unavailable(await call(credential));
    } finally {
      vi.restoreAllMocks();
    }
    expect(stop).not.toHaveBeenCalled();
  },
);

it.each(["personal", "control", "owner", "remote", "move", "deleted"])(
  "cached stops and operation status still require current access: %s",
  async (kind) => {
    const { get, stop, credential } = await setup();
    const reply = await call(credential);
    const operationId = reply.structuredContent.operationId;
    if (kind === "personal")
      get.mockResolvedValue(makeThreadResponse({ id: input.threadId, projectId: "proj_personal" }));
    if (kind === "control") f.change({ controlEnabled: false });
    if (kind === "owner") f.change({ owner: "other" });
    if (kind === "remote") f.change({ remoteEnabled: false });
    if (kind === "move" || kind === "deleted")
      get.mockResolvedValue(
        makeThreadResponse({
          id: input.threadId,
          projectId: kind === "move" ? "proj_elsewhere" : "proj_a",
          deletedAt: kind === "deleted" ? 1 : null,
        }),
      );
    if (kind === "owner" || kind === "remote") {
      expect(
        (await f.rpc("tools/call", { name: "bb_stop_thread", arguments: input }, credential))
          .status,
      ).toBe(kind === "remote" ? 503 : 401);
      expect(
        (
          await f.rpc(
            "tools/call",
            { name: "bb_get_operation", arguments: { operationId } },
            credential,
          )
        ).status,
      ).toBe(kind === "remote" ? 503 : 401);
    } else {
      unavailable(await call(credential));
      const view = await poll(operationId);
      if (kind === "control") expect(view.structuredContent.state).toBe("accepted");
      else unavailable(view);
    }
    expect(stop).toHaveBeenCalledTimes(1);
  },
);

it("concurrent retries share one stop identity; changed target conflicts", async () => {
  const { get, stop, credential } = await setup();
  const work = deferred<{ ok: true }>();
  stop.mockImplementation(() => work.promise);
  const replies = await Promise.all(Array.from({ length: 6 }, () => call(credential)));
  const operationId = replies[0].structuredContent.operationId;
  expect(
    replies.every(
      (r) =>
        r.structuredContent.operationId === operationId && r.structuredContent.state === "pending",
    ),
  ).toBe(true);
  expect((await call(credential, { threadId: "  thr_stop  " })).structuredContent.operationId).toBe(
    operationId,
  );
  get.mockImplementation(async ({ threadId }) =>
    makeThreadResponse({ id: threadId, projectId: "proj_a" }),
  );
  expect((await call(credential, { threadId: "thr_other" })).content[0].text).toBe(
    "OPERATION_CONFLICT",
  );
  work.resolve({ ok: true });
  await expect.poll(async () => (await poll(operationId)).structuredContent.state).toBe("accepted");
  expect(stop).toHaveBeenCalledTimes(1);
});

it("start, send and stop have separate tool/key identities", async () => {
  const { get, stop, credential } = await setup();
  get.mockImplementation(async ({ threadId }) =>
    makeThreadResponse({ id: threadId, projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", async () => ({
    providerId: "fixture",
    model: "fixture",
    permissionMode: "auto",
    reasoningLevel: "medium",
    serviceTier: "default",
  }));
  f.host.harness.sdk.stub("threads.spawn", async () =>
    makeThreadResponse({ id: "thr_started", projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("threads.send", async () => ({ ok: true, delivery: "sent" }));
  const ids = [];
  for (const [name, args] of [
    ["bb_start_thread", { projectId: "proj_a", prompt: "Fixture" }],
    ["bb_send_message", { threadId: input.threadId, message: "Fixture" }],
    ["bb_stop_thread", { threadId: input.threadId }],
  ] as const) {
    const result = (
      await (
        await f.rpc(
          "tools/call",
          {
            name,
            arguments: { ...args, operationKey: input.operationKey },
          },
          credential,
        )
      ).json()
    ).result.structuredContent;
    ids.push(result.operationId);
    if (name !== "bb_stop_thread") expect(result).not.toHaveProperty("stopRequested");
  }
  expect(new Set(ids).size).toBe(3);
  expect(stop).toHaveBeenCalledTimes(1);
});

it("BB errors remain unknown, bounded and protected from another stop", async () => {
  const { stop, credential } = await setup();
  stop.mockRejectedValue(new Error("Private BB rejection or connection loss"));
  const reply = await call(credential);
  expect(reply.structuredContent).toMatchObject({
    state: "unknown",
    code: "BB_OUTCOME_UNKNOWN",
    stopRequested: null,
    observation: null,
  });
  expect(JSON.stringify(reply)).not.toMatch(/Private/);
  expect((await call(credential)).structuredContent).toEqual(reply.structuredContent);
  expect((await poll(reply.structuredContent.operationId)).structuredContent).toEqual(
    reply.structuredContent,
  );
  expect(stop).toHaveBeenCalledTimes(1);
});

it.each(["queue", "interaction", "membership"])(
  "keeps stop acknowledgement when %s observations fail",
  async (kind) => {
    const { get, queue, interactions, credential } = await setup();
    if (kind === "queue") queue.mockRejectedValue(new Error("Private queue"));
    if (kind === "interaction") interactions.mockRejectedValue(new Error("Private approval"));
    if (kind === "membership")
      get
        .mockResolvedValueOnce(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }))
        .mockResolvedValueOnce(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }))
        .mockRejectedValueOnce(new Error("Private read failure"));
    const reply = await call(credential);
    expect(reply.structuredContent).toMatchObject({
      state: "accepted",
      stopRequested: true,
      observation: null,
    });
    expect(JSON.stringify(reply)).not.toMatch(/Private/);
  },
);

it("keeps acknowledgement while slow observations time out without a second stop", async () => {
  const { queue, stop, credential } = await setup({ limits: { sdkDeadlineMs: 100 } });
  const work = deferred<Awaited<ReturnType<Threads["queuedMessages"]["list"]>>>();
  queue.mockImplementation(() => work.promise);
  const reply = await call(credential);
  expect(reply.structuredContent).toMatchObject({
    state: "accepted",
    stopRequested: true,
    observation: null,
  });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(
    (await poll(reply.structuredContent.operationId)).structuredContent.observation,
  ).toBeNull();
  expect((await call(credential)).structuredContent.state).toBe("accepted");
  work.resolve([]);
  expect(stop).toHaveBeenCalledTimes(1);
});

it("deadline remains inspectable and a late stop reply can establish acceptance", async () => {
  const { stop, credential } = await setup({ limits: { sdkDeadlineMs: 100 } });
  const work = deferred<{ ok: true }>();
  stop.mockImplementation(() => work.promise);
  const reply = await call(credential);
  expect(reply.structuredContent).toMatchObject({
    state: "pending",
    stopRequested: null,
    observation: null,
  });
  const operationId = reply.structuredContent.operationId;
  await expect.poll(async () => (await poll(operationId)).structuredContent.state).toBe("unknown");
  expect((await call(credential)).structuredContent.state).toBe("unknown");
  work.resolve({ ok: true });
  await expect.poll(async () => (await poll(operationId)).structuredContent.state).toBe("accepted");
  expect(stop).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "reload/crash protects unresolved stop without replay: %s",
  async (crash) => {
    const { stop, credential } = await setup();
    const work = deferred<{ ok: true }>();
    stop.mockImplementation(() => work.promise);
    const reply = await call(credential);
    await f.restart(crash);
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: input.threadId, projectId: "proj_a" }),
    );
    expect((await call(credential)).structuredContent.state).toBe("unknown");
    work.resolve({ ok: true });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await poll(reply.structuredContent.operationId)).structuredContent.state).toBe(
      "unknown",
    );
    expect(stop).toHaveBeenCalledTimes(1);
    expect(f.host.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
  },
);

it.each([false, true])(
  "disconnect does not repeat a stop or dispatch after pre-stop loss: %s",
  async (dispatched) => {
    const { get, stop, credential } = await setup({ limits: { responseWaitMs: 2000 } });
    const work = deferred<{ ok: true }>();
    const ready = deferred<ReturnType<typeof makeThreadResponse>>();
    if (dispatched) stop.mockImplementation(() => work.promise);
    else
      get
        .mockResolvedValueOnce(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }))
        .mockImplementationOnce(() => ready.promise);
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
        params: { name: "bb_stop_thread", arguments: input },
      }),
    }).catch(() => null);
    await expect
      .poll(() => (dispatched ? stop.mock.calls.length : get.mock.calls.length))
      .toBe(dispatched ? 1 : 2);
    controller.abort();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reply = await call(credential);
    expect(reply.structuredContent.state).toBe(dispatched ? "unknown" : "failed");
    if (dispatched) {
      work.resolve({ ok: true });
      await expect
        .poll(async () => (await poll(reply.structuredContent.operationId)).structuredContent.state)
        .toBe("accepted");
      expect(stop).toHaveBeenCalledTimes(1);
    } else {
      ready.resolve(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(stop).not.toHaveBeenCalled();
    }
  },
);

it("lost accepted replies survive restart without another stop", async () => {
  const { stop, credential } = await setup({ limits: { responseWaitMs: 4000 } });
  const reply = await call(credential);
  await f.restart();
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: input.threadId, projectId: "proj_a" }),
  );
  expect((await call(credential)).structuredContent).toEqual(reply.structuredContent);
  expect((await poll(reply.structuredContent.operationId)).structuredContent).toEqual(
    reply.structuredContent,
  );
  expect(stop).toHaveBeenCalledTimes(1);
  expect(f.host.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
});

it("unresolved stops do not expire and ledger capacity safely refuses new keys", async () => {
  let now = 1000;
  const { stop, credential } = await setup({ now: () => now, limits: { capacity: 1 } });
  stop.mockRejectedValue(new Error("Uncertain outcome"));
  const reply = await call(credential);
  now += 365 * 24 * 60 * 60 * 1000;
  expect((await call(credential)).structuredContent.operationId).toBe(
    reply.structuredContent.operationId,
  );
  expect((await call(credential, { operationKey: "new-key" })).content[0].text).toBe("LEDGER_FULL");
  expect(stop).toHaveBeenCalledTimes(1);
});

it("completed stop keys remain protected for at least 24 hours", async () => {
  let now = 1000;
  const { stop, credential } = await setup({ now: () => now, limits: { capacity: 1 } });
  const reply = await call(credential);
  now += 24 * 60 * 60 * 1000;
  expect((await call(credential)).structuredContent.operationId).toBe(
    reply.structuredContent.operationId,
  );
  expect((await call(credential, { operationKey: "new-key" })).content[0].text).toBe("LEDGER_FULL");
  expect(stop).toHaveBeenCalledTimes(1);
});

it("preserves the shared absolute response deadline with slow membership reads", async () => {
  const { get, stop, credential } = await setup({
    limits: { responseWaitMs: 4000, sdkDeadlineMs: 30000 },
  });
  const work = deferred<{ ok: true }>();
  stop.mockImplementation(() => work.promise);
  let reads = 0;
  get.mockImplementation(async () => {
    const delay = ++reads === 1 ? 2400 : reads === 3 ? 500 : 0;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return makeThreadResponse({ id: input.threadId, projectId: "proj_a" });
  });
  const started = Date.now();
  const reply = await call(credential);
  expect(reply.structuredContent.state).toBe("pending");
  expect(Date.now() - started).toBeLessThan(4200);
  work.resolve({ ok: true });
  await expect
    .poll(async () => (await poll(reply.structuredContent.operationId)).structuredContent.state)
    .toBe("accepted");
}, 10000);

it("observation deadlines keep unresponsive SDK read slots occupied until settlement", async () => {
  const { queue, interactions, stop, credential } = await setup({ limits: { sdkDeadlineMs: 50 } });
  const queues = Array.from({ length: 4 }, () =>
    deferred<Awaited<ReturnType<Threads["queuedMessages"]["list"]>>>(),
  );
  const approvals = Array.from({ length: 4 }, () =>
    deferred<Awaited<ReturnType<Threads["interactions"]["list"]>>>(),
  );
  queues.forEach((q) => queue.mockImplementationOnce(() => q.promise));
  approvals.forEach((a) => interactions.mockImplementationOnce(() => a.promise));
  for (let i = 0; i < 4; i++) {
    await call(credential, { operationKey: "busy-" + i });
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  unavailable(await call(credential, { operationKey: "blocked" }));
  expect(stop).toHaveBeenCalledTimes(4);
  queues.forEach((q) => q.resolve([]));
  approvals.forEach((a) => a.resolve([]));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    (await call(credential, { operationKey: "after-settlement" })).structuredContent.state,
  ).toBe("accepted");
});
