import { afterEach, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const inputs = {
  bb_start_thread: {
    projectId: "proj_a",
    prompt: "Private fixture prompt",
    operationKey: "resolve-start",
  },
  bb_send_message: {
    threadId: "thr_target",
    message: "Private fixture instruction",
    operationKey: "resolve-send",
  },
  bb_stop_thread: { threadId: "thr_target", operationKey: "resolve-stop" },
};
type Tool = keyof typeof inputs;
const defaults = {
  providerId: "fixture",
  model: "fixture",
  permissionMode: "accept-edits" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "default",
};
async function call(name: string, args: object, credential?: string) {
  return (await (await f.rpc("tools/call", { name, arguments: args }, credential)).json()).result;
}
async function poll(operationId: string) {
  return call("bb_get_operation", { operationId });
}
async function local(argv: string[]) {
  return f.host.harness.behavior.runCli(argv);
}
async function inspect(operationId: string) {
  const result = await local(["operations", "--operation", operationId, "--json"]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout).operations[0];
}
async function resolve(operationId: string, outcome: string, tool: Tool, delivery?: string) {
  return local([
    "resolve-operation",
    operationId,
    "--outcome",
    outcome,
    "--project",
    "proj_a",
    "--verified",
    "--json",
    ...(tool !== "bb_start_thread" || outcome === "accepted" ? ["--thread", "thr_target"] : []),
    ...(delivery ? ["--delivery", delivery] : []),
  ]);
}
async function setup(options: Parameters<typeof fixture>[1] = {}) {
  f = await fixture({}, { limits: { responseWaitMs: 50, sdkDeadlineMs: 100 }, ...options });
  f.change({ controlEnabled: true });
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", async () => defaults);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_target", projectId: "proj_a" }),
  );
  for (const path of ["threads.spawn", "threads.send", "threads.stop"] as const) {
    f.host.harness.sdk.stub(path, async () => {
      throw new Error("private BB error with credentials");
    });
  }
  return f.token({ scope: "bb.read bb.control" });
}

it.each([
  ["bb_start_thread", undefined],
  ["bb_send_message", "sent"],
  ["bb_send_message", "queued"],
  ["bb_stop_thread", undefined],
] as const)(
  "remote %s status and replay reflect verified acceptance without another BB action, delivery %s",
  async (tool, delivery) => {
    const credential = await setup();
    const uncertain = (await call(tool, inputs[tool], credential)).structuredContent;
    expect(uncertain.state).toBe("unknown");
    const before = await inspect(uncertain.operationId);
    const calls = f.host.harness.inspection.sdk.calls.length;
    expect((await resolve(uncertain.operationId, "accepted", tool, delivery)).exitCode).toBe(0);
    expect(f.host.harness.inspection.sdk.calls).toHaveLength(calls);
    const after = await inspect(uncertain.operationId);
    expect(after).toMatchObject({
      ...before,
      state: "accepted",
      code: "OWNER_VERIFIED_ACCEPTED",
      threadId: "thr_target",
      resolvedAt: expect.any(Number),
      updatedAt: expect.any(Number),
    });
    expect(JSON.stringify(after)).not.toMatch(/Private fixture|private BB error|credentials/);
    const status = (await poll(uncertain.operationId)).structuredContent;
    expect(status).toMatchObject({
      state: "accepted",
      threadId: "thr_target",
      code: "OWNER_VERIFIED_ACCEPTED",
    });
    expect(status.meaning).toMatch(/Owner verified.*not completed/);
    if (tool === "bb_send_message") expect(status).toMatchObject({ delivery, waitingOn: null });
    if (tool === "bb_stop_thread")
      expect(status).toMatchObject({ stopRequested: true, observation: null });
    const repeated = (await call(tool, inputs[tool], credential)).structuredContent;
    expect(repeated).toEqual(status);
    await f.restart();
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "thr_target", projectId: "proj_a" }),
    );
    expect((await poll(uncertain.operationId)).structuredContent).toEqual(status);
    expect((await call(tool, inputs[tool], credential)).structuredContent).toEqual(status);
    for (const path of [
      "threads.spawn",
      "threads.send",
      "threads.stop",
      "threads.interactions.respond",
    ])
      expect(f.host.harness.inspection.sdk.callsTo(path)).toHaveLength(0);
  },
);

it.each(Object.keys(inputs) as Tool[])(
  "verified failure of %s remains protected and does not claim no dispatch",
  async (tool) => {
    const credential = await setup();
    const operationId = (await call(tool, inputs[tool], credential)).structuredContent.operationId;
    const calls = f.host.harness.inspection.sdk.calls.length;
    expect((await resolve(operationId, "failed", tool)).exitCode).toBe(0);
    expect(f.host.harness.inspection.sdk.calls).toHaveLength(calls);
    const status = (await poll(operationId)).structuredContent;
    expect(status).toMatchObject({ state: "failed", code: "OWNER_VERIFIED_FAILED" });
    expect(status.meaning).toMatch(/Owner verified that BB did not accept/);
    expect(status.meaning).not.toMatch(/No .* dispatched/);
    expect((await call(tool, inputs[tool], credential)).structuredContent).toEqual(status);
    await f.restart();
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "thr_target", projectId: "proj_a" }),
    );
    expect((await poll(operationId)).structuredContent).toEqual(status);
    expect((await call(tool, inputs[tool], credential)).structuredContent).toEqual(status);
    for (const path of ["threads.spawn", "threads.send", "threads.stop"])
      expect(f.host.harness.inspection.sdk.callsTo(path)).toHaveLength(0);
  },
);

it("rejects pending and timed-out active operations atomically even when a late BB reply is ready", async () => {
  const credential = await setup({ limits: { responseWaitMs: 50, sdkDeadlineMs: 300 } });
  let complete!: (thread: ReturnType<typeof makeThreadResponse>) => void;
  const spawn = vi.fn(
    () =>
      new Promise<ReturnType<typeof makeThreadResponse>>((resolve) => {
        complete = resolve;
      }),
  );
  f.host.harness.sdk.stub("threads.spawn", spawn);
  const pending = (await call("bb_start_thread", inputs.bb_start_thread, credential))
    .structuredContent;
  expect(pending.state).toBe("pending");
  const before = await inspect(pending.operationId);
  expect(before.active).toBe(true);
  expect((await resolve(pending.operationId, "failed", "bb_start_thread")).stderr).toBe(
    "OPERATION_ACTIVE",
  );
  expect(await inspect(pending.operationId)).toEqual(before);
  await expect.poll(async () => (await inspect(pending.operationId)).state).toBe("unknown");
  const timedOut = await inspect(pending.operationId);
  expect((await resolve(pending.operationId, "accepted", "bb_start_thread")).stderr).toBe(
    "OPERATION_ACTIVE",
  );
  expect(await inspect(pending.operationId)).toEqual(timedOut);
  complete(makeThreadResponse({ id: "thr_target", projectId: "proj_a" }));
  // The promise is ready, but the tracked dispatch still owns the operation until it settles.
  expect((await resolve(pending.operationId, "failed", "bb_start_thread")).stderr).toBe(
    "OPERATION_ACTIVE",
  );
  await expect.poll(async () => (await inspect(pending.operationId)).state).toBe("accepted");
  expect((await inspect(pending.operationId)).resolvedAt).toBeNull();
  expect((await resolve(pending.operationId, "failed", "bb_start_thread")).stderr).toBe(
    "OPERATION_ALREADY_FINAL",
  );
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("retains unresolved keys indefinitely and resolved keys for 24 hours from resolution", async () => {
  let clock = 1000;
  const credential = await setup({ now: () => clock });
  const operationId = (await call("bb_start_thread", inputs.bb_start_thread, credential))
    .structuredContent.operationId;
  clock += 48 * 60 * 60 * 1000;
  expect(
    (await call("bb_start_thread", inputs.bb_start_thread, credential)).structuredContent.state,
  ).toBe("unknown");
  expect((await resolve(operationId, "failed", "bb_start_thread")).exitCode).toBe(0);
  clock += 24 * 60 * 60 * 1000;
  expect(
    (await call("bb_start_thread", inputs.bb_start_thread, credential)).structuredContent,
  ).toMatchObject({ operationId, state: "failed" });
  const conflict = await call(
    "bb_start_thread",
    { ...inputs.bb_start_thread, prompt: "Changed input" },
    credential,
  );
  expect(conflict.content[0].text).toBe("OPERATION_CONFLICT");
  expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  await f.restart();
  expect(
    (await call("bb_start_thread", inputs.bb_start_thread, credential)).structuredContent,
  ).toMatchObject({ operationId, state: "failed" });
  expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
});

it.each(["project", "owner", "issuer", "remote", "moved", "deleted", "missing"])(
  "resolved private results remain inaccessible after %s access loss",
  async (loss) => {
    const credential = await setup();
    const operationId = (await call("bb_start_thread", inputs.bb_start_thread, credential))
      .structuredContent.operationId;
    expect((await resolve(operationId, "accepted", "bb_start_thread")).exitCode).toBe(0);
    f.change({ controlEnabled: false });
    expect((await poll(operationId)).structuredContent.state).toBe("accepted");
    f.change({ controlEnabled: true });
    const token = await f.token();
    if (loss === "project")
      f.host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: "thr_target", projectId: "proj_personal" }),
      );
    if (loss === "owner") f.change({ owner: "other-owner" });
    if (loss === "issuer") f.change({ issuer: "https://other-issuer.example.org" });
    if (loss === "remote") f.change({ remoteEnabled: false });
    if (loss === "moved")
      f.host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: "thr_target", projectId: "proj_other" }),
      );
    if (loss === "deleted")
      f.host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: "thr_target", projectId: "proj_a", deletedAt: Date.now() }),
      );
    if (loss === "missing")
      f.host.harness.sdk.stub("threads.get", async () => {
        throw new Error("private thread details");
      });
    for (const [name, args, auth] of [
      ["bb_get_operation", { operationId }, token],
      ["bb_start_thread", inputs.bb_start_thread, credential],
    ] as const) {
      const reply = await f.rpc("tools/call", { name, arguments: args }, auth);
      const body = await reply.text();
      expect(body).not.toMatch(/thr_target|OWNER_VERIFIED_ACCEPTED|private thread details/);
      if (reply.status === 200) expect(JSON.parse(body).result.isError).toBe(true);
      else expect([401, 403, 503]).toContain(reply.status);
    }
    expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(1);
  },
);
