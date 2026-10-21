import { afterEach, expect, it, vi } from "vitest";
import { makeThreadResponse, makeQueueEntry } from "@get-bb/plugin-sdk/testing";
import { fixture, loopbackFetch } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const input = { threadId: "thr_followup", message: "Synthetic follow-up", operationKey: "send-1" };

type SendResult = Awaited<ReturnType<typeof f.host.bb.sdk.threads.send>>;
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
    { limits: { responseWaitMs: 80, sdkDeadlineMs: 600, ...options.limits }, now: options.now },
  );
  f.change({ controlEnabled: true });
  const get = vi.fn<typeof f.host.bb.sdk.threads.get>(async () =>
    makeThreadResponse({ id: input.threadId, projectId: "proj_a" }),
  );
  const send = vi.fn<typeof f.host.bb.sdk.threads.send>(async () => ({
    ok: true,
    delivery: "sent",
  }));
  f.host.harness.sdk.stub("threads.get", get);
  f.host.harness.sdk.stub("threads.send", send);
  return { get, send, credential: await f.token({ scope: "bb.read bb.control" }) };
}
async function restart(crash = false) {
  await f.restart(crash);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: input.threadId, projectId: "proj_a" }),
  );
}
async function call(credential?: string, changes: object = {}) {
  return (
    await (
      await f.rpc(
        "tools/call",
        { name: "bb_send_message", arguments: { ...input, ...changes } },
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
        { name: "bb_get_operation", arguments: { operationId } },
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
it("sends an idle instruction once and inspects acceptance without claiming completed work", async () => {
  f = await fixture();
  f.change({ controlEnabled: true });
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: input.threadId, projectId: "proj_a", status: "idle" }),
  );
  const send = vi.fn<typeof f.host.bb.sdk.threads.send>(async () => ({
    ok: true,
    delivery: "sent",
  }));
  f.host.harness.sdk.stub("threads.send", send);
  const credential = await f.token({ scope: "bb.read bb.control" });
  const call = async () =>
    (
      await (
        await f.rpc("tools/call", { name: "bb_send_message", arguments: input }, credential)
      ).json()
    ).result;
  const reply = await call();
  expect(reply.structuredContent).toMatchObject({
    state: "accepted",
    threadId: input.threadId,
    delivery: "sent",
    waitingOn: null,
  });
  expect(reply.structuredContent.meaning).toMatch(/not complete/);
  expect((await call()).structuredContent).toEqual(reply.structuredContent);
  const operationId = reply.structuredContent.operationId;
  const poll = await (
    await f.rpc("tools/call", { name: "bb_get_operation", arguments: { operationId } })
  ).json();
  expect(poll.result.structuredContent).toEqual(reply.structuredContent);
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toEqual({
    threadId: input.threadId,
    mode: "auto",
    input: [{ type: "text", text: input.message, mentions: [] }],
  });
  expect(new Set(f.host.harness.inspection.sdk.calls.map((call) => call.path))).toEqual(
    new Set(["threads.get", "threads.send"]),
  );
});

it.each([
  [null, "active"],
  [{ kind: "thread-busy" }, "active"],
  [{ kind: "plugin", pluginId: "dispatch-rule", reason: "Private rule detail" }, "idle"],
  [{ kind: "interaction" }, "idle"],
  [{ kind: "host-offline", hostName: "private-host" }, "idle"],
  [{ kind: "provisioning" }, "idle"],
  [{ kind: "time" }, "idle"],
] as const)(
  "reports queued/deferred input without retry or completion: %j",
  async (waitingOn, status) => {
    const { get, send, credential } = await setup();
    get.mockResolvedValue(makeThreadResponse({ id: input.threadId, projectId: "proj_a", status }));
    send.mockResolvedValue({
      ok: true,
      delivery: "queued",
      queuedMessage: makeQueueEntry({
        threadId: input.threadId,
        waitingOn,
        content: [{ type: "text", text: "Private queue copy", mentions: [] }],
      }),
    });
    const result = await call(credential);
    expect(result.structuredContent).toMatchObject({
      state: "accepted",
      delivery: "queued",
      waitingOn: waitingOn?.kind ?? null,
    });
    expect(result.structuredContent.meaning).toMatch(/queued.*not complete/);
    expect(JSON.stringify(result)).not.toMatch(/Private|private-host|dispatch-rule/);
    await restart();
    expect((await poll(result.structuredContent.operationId)).structuredContent).toEqual(
      result.structuredContent,
    );
    expect((await call(credential)).structuredContent).toEqual(result.structuredContent);
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.host.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  },
);

it("uses BB auto behavior when active input is sent rather than queued", async () => {
  const { get, send, credential } = await setup();
  get.mockResolvedValue(
    makeThreadResponse({ id: input.threadId, projectId: "proj_a", status: "active" }),
  );
  expect((await call(credential)).structuredContent).toMatchObject({
    state: "accepted",
    delivery: "sent",
  });
  expect(send.mock.calls[0][0].mode).toBe("auto");
});

it("advertises a strict text-only write with costs and leaves pending approvals in BB", async () => {
  const { send, credential } = await setup();
  const client = await f.client();
  try {
    const tools = (await client.listTools()).tools;
    const tool = tools.find((t) => t.name === "bb_send_message")!;
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
    expect(Object.keys(tool.inputSchema.properties!)).toEqual([
      "threadId",
      "message",
      "operationKey",
    ]);
    expect(tool.inputSchema.additionalProperties).toBe(false);
    expect(tool.description).toMatch(/code.*external actions.*provider costs/);
    expect(tool.description).toMatch(/Pending approvals remain in BB/);
    expect(tools.map((t) => t.name)).toContain("bb_stop_thread");
  } finally {
    await client.close();
  }
  await call(credential);
  expect(send).toHaveBeenCalledTimes(1);
  expect(
    f.host.harness.inspection.sdk.calls.every((c) =>
      ["threads.get", "threads.send"].includes(c.path),
    ),
  ).toBe(true);
});

it.each([
  { message: "" },
  { message: " \n " },
  { message: "x".repeat(32769) },
  { message: "😀".repeat(8193) },
  { threadId: "" },
  { threadId: "x".repeat(201) },
  { operationKey: "" },
  { operationKey: "x".repeat(129) },
  { operationKey: "bad key" },
  { permissionMode: "full" },
  { model: "override" },
  { providerId: "override" },
  { reasoningLevel: "high" },
  { serviceTier: "override" },
  { mode: "steer" },
  { sendAt: 1 },
  { input: [] },
  { environment: {} },
  { signal: {} },
  { pluginSubmission: {} },
  { executionInputSources: {} },
  { projectId: "proj_a" },
])("rejects invalid and privileged input before a BB call: %j", async (changes) => {
  const { send, get, credential } = await setup();
  expect((await call(credential, changes)).isError).toBe(true);
  expect(send).not.toHaveBeenCalled();
  expect(get).not.toHaveBeenCalled();
});

it("accepts the 32 KiB UTF-8 boundary and preserves message whitespace", async () => {
  const { send, credential } = await setup();
  const message = " 😀".repeat(6553) + "abc";
  expect(Buffer.byteLength(message)).toBe(32768);
  expect((await call(credential, { message })).structuredContent.state).toBe("accepted");
  expect(send.mock.calls[0][0].input).toEqual([{ type: "text", text: message, mentions: [] }]);
});

it("concurrent duplicates share identity, normalized IDs replay, and changed text/target conflicts", async () => {
  const { send, get, credential } = await setup();
  const work = deferred<SendResult>();
  send.mockImplementation(() => work.promise);
  const results = await Promise.all(Array.from({ length: 6 }, () => call(credential)));
  const operationId = results[0].structuredContent.operationId;
  expect(
    results.every(
      (r) =>
        r.structuredContent.operationId === operationId && r.structuredContent.state === "pending",
    ),
  ).toBe(true);
  expect(
    (await call(credential, { threadId: "  " + input.threadId + " " })).structuredContent
      .operationId,
  ).toBe(operationId);
  expect((await call(credential, { message: input.message + " " })).content[0].text).toBe(
    "OPERATION_CONFLICT",
  );
  get.mockImplementation(async ({ threadId }) =>
    makeThreadResponse({ id: threadId, projectId: "proj_a" }),
  );
  expect((await call(credential, { threadId: "thr_other" })).content[0].text).toBe(
    "OPERATION_CONFLICT",
  );
  work.resolve({ ok: true, delivery: "sent" });
  await expect.poll(async () => (await poll(operationId)).structuredContent.state).toBe("accepted");
  expect(send).toHaveBeenCalledTimes(1);
});

it("the same key has separate start and send identities", async () => {
  const { get, send, credential } = await setup();
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
  get.mockImplementation(async ({ threadId }) =>
    makeThreadResponse({ id: threadId, projectId: "proj_a" }),
  );
  const start = (
    await (
      await f.rpc(
        "tools/call",
        {
          name: "bb_start_thread",
          arguments: { projectId: "proj_a", prompt: "Fixture", operationKey: input.operationKey },
        },
        credential,
      )
    ).json()
  ).result;
  const message = await call(credential);
  expect(message.structuredContent.operationId).not.toBe(start.structuredContent.operationId);
  expect(start.structuredContent).not.toHaveProperty("delivery");
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(["bb.read", "bb.control", ""])(
  "denies missing scope %s before membership/dispatch",
  async (scope) => {
    const { send, get } = await setup();
    const response = await f.rpc(
      "tools/call",
      { name: "bb_send_message", arguments: input },
      await f.token({ scope }),
    );
    if (scope === "bb.read") unavailable((await response.json()).result);
    else expect(response.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  },
);

it.each([{ controlEnabled: false }, { remoteEnabled: false }, { owner: "other" }])(
  "denies live local access removal before any BB read: %j",
  async (change) => {
    const { send, get, credential } = await setup();
    f.change(change);
    const response = await f.rpc(
      "tools/call",
      { name: "bb_send_message", arguments: input },
      credential,
    );
    if (change.controlEnabled === false) unavailable((await response.json()).result);
    else expect(response.status).toBe(change.remoteEnabled === false ? 503 : 401);
    expect(send).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  },
);

it.each(["outside", "missing", "deleted", "projectless"])(
  "direct IDs do not bypass membership: %s",
  async (kind) => {
    const { get, send, credential } = await setup();
    if (kind === "missing") get.mockRejectedValue(new Error("Private missing detail"));
    else
      get.mockResolvedValue(
        makeThreadResponse({
          id: input.threadId,
          projectId: kind === "outside" ? "proj_personal" : kind === "projectless" ? "" : "proj_a",
          deletedAt: kind === "deleted" ? 1 : null,
        }),
      );
    const result = await call(credential);
    unavailable(result);
    expect(JSON.stringify(result)).not.toMatch(/Private|proj_personal/);
    expect(send).not.toHaveBeenCalled();
  },
);

it.each(["remote", "control", "owner", "expiry", "move"])(
  "rechecks access and membership immediately before dispatch: %s",
  async (kind) => {
    const { get, send, credential } = await setup();
    let reads = 0;
    get.mockImplementation(async () => {
      reads++;
      if (reads === 2) {
        if (kind === "remote") f.change({ remoteEnabled: false });
        if (kind === "control") f.change({ controlEnabled: false });
        if (kind === "owner") f.change({ owner: "other" });
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
    expect(send).not.toHaveBeenCalled();
  },
);

it.each(["project", "control", "move", "deleted"])(
  "does not expose cached results after current access changes: %s",
  async (kind) => {
    const { get, send, credential } = await setup();
    const result = await call(credential);
    const operationId = result.structuredContent.operationId;
    if (kind === "project")
      get.mockResolvedValue(makeThreadResponse({ id: input.threadId, projectId: "proj_personal" }));
    if (kind === "control") f.change({ controlEnabled: false });
    if (kind === "move")
      get.mockResolvedValue(
        makeThreadResponse({ id: input.threadId, projectId: "proj_elsewhere" }),
      );
    if (kind === "deleted")
      get.mockResolvedValue(
        makeThreadResponse({ id: input.threadId, projectId: "proj_a", deletedAt: 1 }),
      );
    unavailable(await call(credential));
    const view = await poll(operationId);
    if (kind === "control") expect(view.structuredContent.state).toBe("accepted");
    else unavailable(view);
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it.each(["BB rejection", "connection loss", "uncertain dispatch"])(
  "protects errors after invoking send without unsafe retries: %s",
  async (reason) => {
    const { send, credential } = await setup();
    send.mockRejectedValue(new Error(reason + " private message"));
    const result = await call(credential);
    expect(result.structuredContent).toMatchObject({
      state: "unknown",
      threadId: input.threadId,
      delivery: null,
      code: "BB_OUTCOME_UNKNOWN",
    });
    expect(result.structuredContent.meaning).toMatch(/Inspect BB/);
    expect(JSON.stringify(result)).not.toMatch(/private message/);
    expect((await call(credential)).structuredContent).toEqual(result.structuredContent);
    expect(send).toHaveBeenCalledTimes(1);
  },
);

it("a pending send hits its deadline, remains inspectable, and can record a late known result", async () => {
  const { send, credential } = await setup({ limits: { sdkDeadlineMs: 100 } });
  const work = deferred<SendResult>();
  send.mockImplementation(() => work.promise);
  const result = await call(credential);
  expect(result.structuredContent.state).toBe("pending");
  const operationId = result.structuredContent.operationId;
  await expect.poll(async () => (await poll(operationId)).structuredContent.state).toBe("unknown");
  expect((await call(credential)).structuredContent.state).toBe("unknown");
  work.resolve({ ok: true, delivery: "sent" });
  await expect.poll(async () => (await poll(operationId)).structuredContent.delivery).toBe("sent");
  expect(send).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "reload/crash keeps unknown input protected with no replay: crash=%s",
  async (crash) => {
    const { send, credential } = await setup();
    const work = deferred<SendResult>();
    send.mockImplementation(() => work.promise);
    const result = await call(credential);
    expect(result.structuredContent.state).toBe("pending");
    await restart(crash);
    const operationId = result.structuredContent.operationId;
    expect((await poll(operationId)).structuredContent.state).toBe("unknown");
    expect((await call(credential)).structuredContent.state).toBe("unknown");
    work.resolve({ ok: true, delivery: "sent" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await poll(operationId)).structuredContent.state).toBe("unknown");
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.host.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  },
);

it("a reload during pre-dispatch membership cannot submit from the old generation", async () => {
  const { get, send, credential } = await setup();
  const ready = deferred<ReturnType<typeof makeThreadResponse>>();
  get
    .mockResolvedValueOnce(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }))
    .mockImplementationOnce(() => ready.promise);
  const result = await call(credential);
  expect(result.structuredContent.state).toBe("pending");
  await restart(true);
  ready.resolve(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await poll(result.structuredContent.operationId)).structuredContent.state).toBe(
    "unknown",
  );
  expect(send).not.toHaveBeenCalled();
});

it("a failed pre-dispatch membership read is confirmed failed, not retried", async () => {
  const { get, send, credential } = await setup();
  get.mockRejectedValueOnce(new Error("No dispatch"));
  unavailable(await call(credential));
  get
    .mockResolvedValueOnce(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }))
    .mockRejectedValueOnce(new Error("No dispatch"));
  const result = await call(credential);
  expect(result.structuredContent).toMatchObject({
    state: "failed",
    code: "MESSAGE_NOT_DISPATCHED",
    delivery: null,
  });
  expect(result.structuredContent.meaning).toMatch(/No message was dispatched/);
  expect((await call(credential)).structuredContent.state).toBe("failed");
  expect(send).not.toHaveBeenCalled();
});

it("unresolved send keys remain protected at capacity and after one year/restart", async () => {
  let now = 1000;
  const { send, credential } = await setup({ now: () => now, limits: { capacity: 1 } });
  send.mockRejectedValue(new Error("Unknown"));
  const result = await call(credential);
  now += 365 * 24 * 60 * 60 * 1000;
  expect((await call(credential)).structuredContent.operationId).toBe(
    result.structuredContent.operationId,
  );
  expect((await call(credential, { operationKey: "new-key" })).content[0].text).toBe("LEDGER_FULL");
  await restart();
  expect((await call(credential)).structuredContent.state).toBe("unknown");
  expect(f.host.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
});

it.each([false, true])(
  "disconnect protects input and does not stop work: dispatched=%s",
  async (dispatched) => {
    const { get, send, credential } = await setup({ limits: { responseWaitMs: 2000 } });
    const work = deferred<SendResult>();
    const ready = deferred<ReturnType<typeof makeThreadResponse>>();
    if (dispatched) send.mockImplementation(() => work.promise);
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
        params: { name: "bb_send_message", arguments: input },
      }),
    }).catch(() => null);
    await expect
      .poll(() => (dispatched ? send.mock.calls.length : get.mock.calls.length))
      .toBe(dispatched ? 1 : 2);
    controller.abort();
    await request;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const replay = await call(credential);
    expect(replay.structuredContent.state).toBe(dispatched ? "unknown" : "failed");
    if (dispatched) {
      work.resolve({ ok: true, delivery: "sent" });
      await expect
        .poll(
          async () => (await poll(replay.structuredContent.operationId)).structuredContent.state,
        )
        .toBe("accepted");
      expect(send).toHaveBeenCalledTimes(1);
    } else {
      ready.resolve(makeThreadResponse({ id: input.threadId, projectId: "proj_a" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(send).not.toHaveBeenCalled();
    }
    expect(f.host.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
  },
);

it("a lost accepted reply stays inspectable after restart with no second send", async () => {
  const { send, credential } = await setup();
  const discarded = await call(credential);
  await restart();
  expect((await call(credential)).structuredContent).toEqual(discarded.structuredContent);
  expect((await poll(discarded.structuredContent.operationId)).structuredContent).toEqual(
    discarded.structuredContent,
  );
  expect(send).toHaveBeenCalledTimes(1);
  expect(f.host.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
});

it("completed send keys remain protected for the full 24-hour window", async () => {
  let now = 1000;
  const { send, credential } = await setup({ now: () => now, limits: { capacity: 1 } });
  const result = await call(credential);
  now += 24 * 60 * 60 * 1000;
  expect((await call(credential)).structuredContent.operationId).toBe(
    result.structuredContent.operationId,
  );
  expect((await call(credential, { operationKey: "new" })).content[0].text).toBe("LEDGER_FULL");
  now++;
  expect((await call(credential)).structuredContent.operationId).not.toBe(
    result.structuredContent.operationId,
  );
  expect(send).toHaveBeenCalledTimes(2);
});

it("current membership is checked after an awaited cached read and an owner cannot inspect another owner", async () => {
  const { get, send, credential } = await setup();
  const result = await call(credential);
  get.mockImplementation(async () => {
    f.change({ remoteEnabled: false });
    return makeThreadResponse({ id: input.threadId, projectId: "proj_a" });
  });
  unavailable(await poll(result.structuredContent.operationId));
  f.change({ remoteEnabled: true, owner: "other" });
  unavailable(await poll(result.structuredContent.operationId));
  expect(send).toHaveBeenCalledTimes(1);
});

it("returns a pending operation within the production budget after a slow initial membership read", async () => {
  f = await fixture();
  f.change({ controlEnabled: true });
  let reads = 0;
  f.host.harness.sdk.stub("threads.get", async () => {
    if (++reads === 1) await new Promise((resolve) => setTimeout(resolve, 2300));
    return makeThreadResponse({ id: input.threadId, projectId: "proj_a" });
  });
  const work = deferred<SendResult>();
  const send = vi.fn<typeof f.host.bb.sdk.threads.send>(() => work.promise);
  f.host.harness.sdk.stub("threads.send", send);
  const credential = await f.token({ scope: "bb.read bb.control" });
  const started = Date.now();
  const response = await f.rpc(
    "tools/call",
    { name: "bb_send_message", arguments: input },
    credential,
  );
  const elapsed = Date.now() - started;
  expect(response.status).toBe(200);
  expect(elapsed).toBeLessThan(4000);
  const result = (await response.json()).result;
  expect(result.structuredContent).toMatchObject({
    state: "pending",
    code: null,
    threadId: input.threadId,
  });
  const operationId = result.structuredContent.operationId;
  expect(operationId).toEqual(expect.any(String));
  expect((await poll(operationId)).structuredContent.state).toBe("pending");
  expect(JSON.stringify(f.logs)).not.toContain("DEADLINE");
  expect(send).toHaveBeenCalledTimes(1);
  work.resolve({ ok: true, delivery: "sent" });
  await expect.poll(async () => (await poll(operationId)).structuredContent.state).toBe("accepted");
  expect((await call(credential)).structuredContent.operationId).toBe(operationId);
  expect(send).toHaveBeenCalledTimes(1);
}, 10000);
