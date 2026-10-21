import { afterEach, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture, loopbackFetch } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const input = {
  projectId: "proj_a",
  prompt: "Workspace fixture",
  title: "Fixture",
  operationKey: "workspace",
};
const defaults = {
  providerId: "fixture",
  model: "fixture-model",
  permissionMode: "accept-edits" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "default",
};
type Config = Awaited<ReturnType<NonNullable<typeof f>["host"]["bb"]["sdk"]["system"]["config"]>>;
const config = (primaryHostId: unknown) =>
  ({ primaryHostId, privateValue: "config-secret" }) as unknown as Config;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function setup(limits: Parameters<typeof fixture>[1] = {}) {
  f = await fixture({}, { limits: { responseWaitMs: 40, sdkDeadlineMs: 1000 }, ...limits });
  f.change({ controlEnabled: true });
  const readDefaults = vi.fn<typeof f.host.bb.sdk.projects.defaultExecutionOptions>(
    async () => defaults,
  );
  const readConfig = vi.fn<typeof f.host.bb.sdk.system.config>(async () => config("host_primary"));
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
    makeThreadResponse({ id: "thr_workspace", projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
  f.host.harness.sdk.stub("system.config", readConfig);
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_workspace", projectId: "proj_a" }),
  );
  return { readDefaults, readConfig, spawn, token: await f.token({ scope: "bb.read bb.control" }) };
}
async function call(token: string, changes: object = {}) {
  return (
    await (
      await f.rpc(
        "tools/call",
        { name: "bb_start_thread", arguments: { ...input, ...changes } },
        token,
      )
    ).json()
  ).result;
}
async function poll(operationId: string) {
  return (
    await (
      await f.rpc("tools/call", { name: "bb_get_operation", arguments: { operationId } })
    ).json()
  ).result;
}
const modes = [undefined, "project-folder", "worktree"] as const;
it.each(modes)("submits the exact %s environment and all execution defaults", async (workspace) => {
  const { readDefaults, readConfig, spawn, token } = await setup();
  const result = await call(token, workspace ? { workspace } : {});
  expect(result.structuredContent).toMatchObject({
    state: "accepted",
    threadId: "thr_workspace",
    code: null,
  });
  expect(spawn.mock.calls).toEqual([
    [
      {
        providerId: "fixture",
        model: "fixture-model",
        permissionMode: "accept-edits",
        reasoningLevel: "medium",
        serviceTier: "default",
        projectId: "proj_a",
        prompt: "Workspace fixture",
        title: "Fixture",
        visibility: "visible",
        environment:
          workspace === undefined
            ? { type: "project-default" }
            : workspace === "project-folder"
              ? {
                  type: "host",
                  hostId: "host_primary",
                  workspace: { type: "unmanaged", path: null },
                }
              : {
                  type: "host",
                  hostId: "host_primary",
                  workspace: { type: "managed-worktree", baseBranch: { kind: "default" } },
                },
        pluginMetadata: { operationId: result.structuredContent.operationId },
        origin: "plugin",
        originPluginId: "test-plugin",
      },
    ],
  ]);
  expect(readDefaults.mock.calls).toEqual([
    [{ projectId: "proj_a", signal: expect.any(AbortSignal) }],
  ]);
  expect(readConfig.mock.calls).toEqual(workspace ? [[{ signal: expect.any(AbortSignal) }]] : []);
  const hashes = {
    omitted: "230f795890dbd1d1ef265933456dd5392822a535e790a434015653a3619fa653",
    "project-folder": "8c7e426d8f931c529e85a06119d76f6f189316200aca1631326145a04405579f",
    worktree: "93c3f25d86c8dc3b6e3dff076d5feb33d1eabcc7b962454351a54d822a93d0df",
  };
  expect(
    f.host.bb.storage
      .database()
      .prepare("SELECT hash FROM operations WHERE id = ?")
      .get(result.structuredContent.operationId),
  ).toEqual({ hash: hashes[workspace ?? "omitted"] });
  if (workspace === undefined) {
    for (const explicit of ["project-folder", "worktree"])
      expect((await call(token, { workspace: explicit })).content).toEqual([
        { type: "text", text: "OPERATION_CONFLICT" },
      ]);
  }
  readConfig.mockRejectedValue(new Error("changed primary config"));
  readDefaults.mockRejectedValue(new Error("changed execution config"));
  expect((await call(token, workspace ? { workspace } : {})).structuredContent).toEqual(
    result.structuredContent,
  );
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(readConfig).toHaveBeenCalledTimes(workspace ? 1 : 0);
});

it.each([
  { workspace: null },
  { workspace: "project-default" },
  { workspace: "folder" },
  { workspace: "reuse" },
  { workspace: {} },
  { workspace: { type: "unmanaged", path: "/tmp/private" } },
  { workspace: { type: "managed-worktree", baseBranch: { kind: "default" } } },
  { workspace: "worktree", hostId: "host_other" },
  { workspace: "worktree", path: "/tmp/private" },
  { workspace: "worktree", branch: "main" },
  { workspace: "worktree", reuse: "env_other" },
  { workspace: "worktree", permissionMode: "full" },
  { workspace: "worktree", environment: { type: "project-default" } },
  { workspace: "worktree", environmentProviderId: "git-worktree" },
  { workspace: "worktree", model: "other" },
  { workspace: "worktree", reasoningLevel: "high" },
  { workspace: "worktree", serviceTier: "priority" },
])("rejects unsupported selection %j before any BB read", async (changes) => {
  const { readDefaults, readConfig, spawn, token } = await setup();
  const result = await call(token, changes);
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain("Input validation error");
  expect(readDefaults.mock.calls).toEqual([]);
  expect(readConfig.mock.calls).toEqual([]);
  expect(spawn.mock.calls).toEqual([]);
});

it.each(["project-folder", "worktree"] as const)(
  "denies Personal and read-only callers before %s config resolution",
  async (workspace) => {
    const { readDefaults, readConfig, spawn, token } = await setup();
    for (const [credential, changes] of [
      [token, { projectId: "proj_personal", workspace }],
      [await f.token(), { workspace }],
    ] as const) {
      expect((await call(credential, changes)).content).toEqual([
        { type: "text", text: "OPERATION_UNAVAILABLE" },
      ]);
    }
    expect(readDefaults.mock.calls).toEqual([]);
    expect(readConfig.mock.calls).toEqual([]);
    expect(spawn.mock.calls).toEqual([]);
  },
);

it.each(["project-folder", "worktree"] as const)(
  "claims %s intent once concurrently and rejects changed or omitted placement",
  async (workspace) => {
    const { readConfig, spawn, token } = await setup();
    const ready = deferred<Config>();
    readConfig.mockImplementation(() => ready.promise);
    const results = await Promise.all(Array.from({ length: 4 }, () => call(token, { workspace })));
    expect(results.map((r) => r.structuredContent.state)).toEqual([
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(new Set(results.map((r) => r.structuredContent.operationId)).size).toBe(1);
    expect(readConfig).toHaveBeenCalledTimes(1);
    for (const changes of [
      {},
      { workspace: workspace === "worktree" ? "project-folder" : "worktree" },
    ])
      expect((await call(token, changes)).content).toEqual([
        { type: "text", text: "OPERATION_CONFLICT" },
      ]);
    ready.resolve(config("host_primary"));
    await expect
      .poll(
        async () => (await poll(results[0].structuredContent.operationId)).structuredContent.state,
      )
      .toBe("accepted");
    const reordered = {
      workspace,
      operationKey: "workspace",
      title: "Fixture",
      prompt: "Workspace fixture",
      projectId: "proj_a",
    };
    const reply = await (
      await f.rpc("tools/call", { name: "bb_start_thread", arguments: reordered }, token)
    ).json();
    expect(reply.result.structuredContent.state).toBe("accepted");
    expect(spawn).toHaveBeenCalledTimes(1);
    await f.restart();
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "thr_workspace", projectId: "proj_a" }),
    );
    expect((await call(token, { workspace })).structuredContent.state).toBe("accepted");
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["threads.get"]);
  },
);

it.each([null, undefined, "", "  ", 42, {}, "x".repeat(201), "reject"])(
  "fails invalid primary host %j before dispatch without config leakage",
  async (host) => {
    const { readConfig, spawn, token } = await setup();
    readConfig.mockImplementation(async () => {
      if (host === "reject") throw new Error("config-secret");
      return config(host);
    });
    const result = await call(token, { workspace: "worktree" });
    expect(result.structuredContent).toMatchObject({
      state: "failed",
      threadId: null,
      code: "START_NOT_DISPATCHED",
    });
    expect(JSON.stringify([result, f.logs])).not.toContain("config-secret");
    expect((await call(token, { workspace: "worktree" })).structuredContent).toEqual(
      result.structuredContent,
    );
    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls).toEqual([]);
  },
);

it("fails a missing system config before dispatch", async () => {
  const { readConfig, spawn, token } = await setup();
  readConfig.mockResolvedValue(null as unknown as Config);
  const result = await call(token, { workspace: "project-folder" });
  expect(result.structuredContent).toMatchObject({
    state: "failed",
    threadId: null,
    code: "START_NOT_DISPATCHED",
  });
  expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([
    "projects.defaultExecutionOptions",
    "system.config",
  ]);
  expect(spawn.mock.calls).toEqual([]);
});

it.each([
  { controlEnabled: false },
  { owner: "other" },
  { authMode: "cloudflare-access" as const, accessPermission: "read-control" as const },
  { remoteEnabled: false },
])("rechecks live access after delayed config %j", async (change) => {
  const { readConfig, spawn, token } = await setup();
  const ready = deferred<Config>();
  readConfig.mockImplementation(() => ready.promise);
  const pending = await call(token, { workspace: "project-folder" });
  expect(pending.structuredContent.state).toBe("pending");
  f.change(change);
  ready.resolve(config("host_primary"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  f.change({ controlEnabled: true, remoteEnabled: true, owner: "owner-1", authMode: "bearer-jwt" });
  expect((await call(token, { workspace: "project-folder" })).structuredContent).toMatchObject({
    state: "failed",
    code: "START_NOT_DISPATCHED",
  });
  expect(spawn.mock.calls).toEqual([]);
});

it("rechecks identity expiry after delayed config", async () => {
  const { readConfig, spawn } = await setup({
    limits: { responseWaitMs: 40, sdkDeadlineMs: 3000 },
  });
  const ready = deferred<Config>();
  readConfig.mockImplementation(() => ready.promise);
  const token = await f.token({
    scope: "bb.read bb.control",
    exp: Math.floor(Date.now() / 1000) + 1,
  });
  const pending = await call(token, { workspace: "worktree" });
  expect(pending.structuredContent.state).toBe("pending");
  await new Promise((resolve) => setTimeout(resolve, 1100));
  ready.resolve(config("host_primary"));
  await expect
    .poll(async () => (await poll(pending.structuredContent.operationId)).structuredContent.state)
    .toBe("failed");
  expect(spawn.mock.calls).toEqual([]);
});

it.each([false, true])("late config cannot dispatch after restart, crash=%s", async (crash) => {
  const { readConfig, spawn, token } = await setup();
  const ready = deferred<Config>();
  readConfig.mockImplementation(() => ready.promise);
  const pending = await call(token, { workspace: "worktree" });
  expect(pending.structuredContent.state).toBe("pending");
  await f.restart(crash);
  ready.resolve(config("host_primary"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await call(token, { workspace: "worktree" })).structuredContent).toMatchObject({
    state: "unknown",
    code: crash ? "PLUGIN_RESTART" : "PLUGIN_STOPPED",
  });
  expect(spawn.mock.calls).toEqual([]);
  expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([]);
});

it("late config cannot dispatch after local resolution", async () => {
  const { readConfig, spawn, token } = await setup();
  const ready = deferred<Config>();
  readConfig.mockImplementation(() => ready.promise);
  const pending = await call(token, { workspace: "worktree" });
  const args = [
    "resolve-operation",
    pending.structuredContent.operationId,
    "--outcome",
    "failed",
    "--project",
    "proj_a",
    "--verified",
    "--json",
  ];
  const active = await f.host.harness.behavior.runCli(args);
  expect(active).toMatchObject({
    exitCode: 1,
    stderr: expect.stringContaining("OPERATION_ACTIVE"),
  });
  await f.restart();
  const resolved = await f.host.harness.behavior.runCli(args);
  expect(resolved.exitCode).toBe(0);
  ready.resolve(config("host_primary"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await call(token, { workspace: "worktree" })).structuredContent).toMatchObject({
    state: "failed",
    code: "OWNER_VERIFIED_FAILED",
  });
  expect(spawn.mock.calls).toEqual([]);
});

it("bounds config by the remaining original SDK budget after defaults", async () => {
  const { readDefaults, readConfig, spawn, token } = await setup({
    limits: { responseWaitMs: 30, sdkDeadlineMs: 300 },
  });
  readDefaults.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 180));
    return defaults;
  });
  const ready = deferred<Config>();
  readConfig.mockImplementation(() => ready.promise);
  const result = await call(token, { workspace: "worktree" });
  expect(result.structuredContent.state).toBe("pending");
  await expect.poll(() => readConfig.mock.calls.length).toBe(1);
  const signal = readConfig.mock.calls[0][0]!.signal!;
  expect(signal.aborted).toBe(false);
  await expect
    .poll(async () => (await poll(result.structuredContent.operationId)).structuredContent.code)
    .toBe("PRE_DISPATCH_DEADLINE");
  expect(signal.aborted).toBe(true);
  ready.resolve(config("host_primary"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await call(token, { workspace: "worktree" })).structuredContent.state).toBe("failed");
  expect(spawn.mock.calls).toEqual([]);
});

it("never begins config when defaults finish after the deadline", async () => {
  const { readDefaults, readConfig, spawn, token } = await setup({
    limits: { responseWaitMs: 30, sdkDeadlineMs: 70 },
  });
  const ready = deferred<typeof defaults>();
  readDefaults.mockImplementation(() => ready.promise);
  const result = await call(token, { workspace: "worktree" });
  await expect
    .poll(async () => (await poll(result.structuredContent.operationId)).structuredContent.code)
    .toBe("PRE_DISPATCH_DEADLINE");
  ready.resolve(defaults);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect((await call(token, { workspace: "worktree" })).structuredContent.code).toBe(
    "PRE_DISPATCH_DEADLINE",
  );
  expect(readConfig.mock.calls).toEqual([]);
  expect(spawn.mock.calls).toEqual([]);
});

it.each(["defaults", "config"])(
  "disconnect during %s never dispatches after late completion",
  async (stage) => {
    const { readDefaults, readConfig, spawn, token } = await setup({
      limits: { responseWaitMs: 2000, sdkDeadlineMs: 3000 },
    });
    const defaultsReady = deferred<typeof defaults>();
    const configReady = deferred<Config>();
    if (stage === "defaults") readDefaults.mockImplementation(() => defaultsReady.promise);
    else readConfig.mockImplementation(() => configReady.promise);
    const controller = new AbortController();
    const request = loopbackFetch(f.local + "/mcp", {
      method: "POST",
      signal: controller.signal,
      headers: {
        host: "mcp.example.org",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "bb_start_thread", arguments: { ...input, workspace: "worktree" } },
      }),
    }).catch(() => null);
    await expect
      .poll(() =>
        stage === "defaults" ? readDefaults.mock.calls.length : readConfig.mock.calls.length,
      )
      .toBe(1);
    controller.abort();
    await request;
    await expect
      .poll(async () => (await call(token, { workspace: "worktree" })).structuredContent.code)
      .toBe("PRE_DISPATCH_ABORTED");
    if (stage === "config") expect(readConfig.mock.calls[0][0]!.signal!.aborted).toBe(true);
    defaultsReady.resolve(defaults);
    configReady.resolve(config("host_primary"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(spawn.mock.calls).toEqual([]);
    expect(readConfig).toHaveBeenCalledTimes(stage === "config" ? 1 : 0);
  },
);

it.each(["project-folder", "worktree"] as const)(
  "preserves unknown %s rejection without substitution and across restart",
  async (workspace) => {
    const { readConfig, spawn, token } = await setup();
    for (const reason of ["missing-source", "invalid-host", "non-Git", "unavailable-provider"]) {
      spawn.mockRejectedValueOnce(new Error(reason + " private"));
      const changes = { workspace, operationKey: reason };
      const result = await call(token, changes);
      expect(result.structuredContent).toMatchObject({
        state: "unknown",
        code: "BB_OUTCOME_UNKNOWN",
        threadId: null,
      });
      expect(JSON.stringify([result, f.logs])).not.toContain("private");
      expect((await call(token, changes)).structuredContent).toEqual(result.structuredContent);
    }
    expect(spawn).toHaveBeenCalledTimes(4);
    expect(readConfig).toHaveBeenCalledTimes(4);
    await f.restart();
    expect(
      (await call(token, { workspace, operationKey: "non-Git" })).structuredContent.state,
    ).toBe("unknown");
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual([]);
  },
);

it.each(["project-folder", "worktree"] as const)(
  "records late %s acceptance after the dispatch deadline without another lookup",
  async (workspace) => {
    const { readConfig, spawn, token } = await setup({
      limits: { responseWaitMs: 30, sdkDeadlineMs: 90 },
    });
    const work = deferred<ReturnType<typeof makeThreadResponse>>();
    spawn.mockImplementation(() => work.promise);
    const result = await call(token, { workspace });
    expect(result.structuredContent.state).toBe("pending");
    await expect
      .poll(async () => (await poll(result.structuredContent.operationId)).structuredContent.state)
      .toBe("unknown");
    expect((await call(token, { workspace })).structuredContent.state).toBe("unknown");
    work.resolve(makeThreadResponse({ id: "thr_workspace", projectId: "proj_a" }));
    await expect
      .poll(async () => (await poll(result.structuredContent.operationId)).structuredContent.state)
      .toBe("accepted");
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(readConfig).toHaveBeenCalledTimes(1);
  },
);
