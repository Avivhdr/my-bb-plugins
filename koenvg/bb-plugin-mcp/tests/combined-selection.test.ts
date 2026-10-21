import { afterEach, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture, provider } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  vi.restoreAllMocks();
  await f?.close();
});
const input = {
  projectId: "proj_a",
  prompt: "Workspace fixture",
  title: "Fixture",
  operationKey: "combined",
};
const defaults = {
  providerId: "saved",
  model: "saved-model",
  permissionMode: "accept-edits" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "saved-tier",
};
type SystemConfig = Awaited<ReturnType<typeof f.host.bb.sdk.system.config>>;
const config = { primaryHostId: "host_primary" } as SystemConfig;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function setup(options: Parameters<typeof fixture>[1] = {}) {
  f = await fixture({}, { limits: { responseWaitMs: 40, sdkDeadlineMs: 5000 }, ...options });
  f.change({ controlEnabled: true });
  const readDefaults = vi.fn<typeof f.host.bb.sdk.projects.defaultExecutionOptions>(
    async () => defaults,
  );
  const providers = vi.fn<typeof f.host.bb.sdk.providers.list>(async () => [
    provider("saved"),
    provider("other"),
  ]);
  const readConfig = vi.fn<typeof f.host.bb.sdk.system.config>(async () => config);
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
    makeThreadResponse({ id: "thr_combined", projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
  f.host.harness.sdk.stub("providers.list", providers);
  f.host.harness.sdk.stub("system.config", readConfig);
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_combined", projectId: "proj_a" }),
  );
  const credential = await f.token({ scope: "bb.read bb.control" });
  return {
    readDefaults,
    providers,
    readConfig,
    spawn,
    start: async (selection: object) =>
      (
        await (
          await f.rpc(
            "tools/call",
            { name: "bb_start_thread", arguments: { ...input, ...selection } },
            credential,
          )
        ).json()
      ).result,
  };
}

it.each([
  ["saved", "project-folder", "d16167700fa94a947adceb3a40379086cb513d2775e515a51338732ac334180a"],
  ["saved", "worktree", "e7da38ba0038bf3718b81a20b94906436d80d3ac741f31db4d3c4d6a601c52d7"],
  ["other", "project-folder", "151119858b6c77430c608a7c8d45c5568d6043e7a8cc2392cd80e8646a452ef6"],
  ["other", "worktree", "2261c82142f0aab7594e74d8f6f59ef0f4b7b0f9be1258a2b6ea71ea167b18ec"],
] as const)(
  "combines %s and %s exactly once and replays across restart",
  async (providerId, workspace, hash) => {
    const { start, readDefaults, providers, readConfig, spawn } = await setup();
    const ready = deferred<SystemConfig>();
    readConfig.mockImplementation(() => ready.promise);
    const selection = { providerId: ` ${providerId} `, workspace };
    const results = await Promise.all(Array.from({ length: 4 }, () => start(selection)));
    const operationId = results[0].structuredContent.operationId;
    for (const result of results)
      expect(result.structuredContent).toMatchObject({ operationId, state: "pending" });
    expect(
      f.host.bb.storage
        .database()
        .prepare("SELECT hash FROM operations WHERE id = ?")
        .get(operationId),
    ).toEqual({ hash });
    for (const changed of [
      { providerId },
      { workspace },
      {},
      { providerId: providerId === "saved" ? "other" : "saved", workspace },
      { providerId, workspace: workspace === "worktree" ? "project-folder" : "worktree" },
    ])
      expect(await start(changed)).toEqual({
        isError: true,
        content: [{ type: "text", text: "OPERATION_CONFLICT" }],
      });
    ready.resolve(config);
    await expect
      .poll(async () => (await start(selection)).structuredContent.state)
      .toBe("accepted");
    const accepted = (await start({ workspace, providerId })).structuredContent;
    expect(accepted).toMatchObject({
      operationId,
      threadId: "thr_combined",
      state: "accepted",
      code: null,
    });
    expect(spawn.mock.calls).toEqual([
      [
        {
          ...(providerId === "saved"
            ? defaults
            : { providerId: "other", permissionMode: "accept-edits" }),
          projectId: "proj_a",
          prompt: "Workspace fixture",
          title: "Fixture",
          environment: {
            type: "host",
            hostId: "host_primary",
            workspace:
              workspace === "project-folder"
                ? { type: "unmanaged", path: null }
                : { type: "managed-worktree", baseBranch: { kind: "default" } },
          },
          visibility: "visible",
          pluginMetadata: { operationId },
          origin: "plugin",
          originPluginId: "test-plugin",
        },
      ],
    ]);
    expect(f.host.harness.inspection.sdk.calls.slice(0, 4).map((c) => c.path)).toEqual([
      "projects.defaultExecutionOptions",
      "providers.list",
      "system.config",
      "threads.spawn",
    ]);
    expect(readDefaults.mock.calls).toEqual([
      [{ projectId: "proj_a", signal: expect.any(AbortSignal) }],
    ]);
    expect(providers.mock.calls).toEqual([[{ signal: expect.any(AbortSignal) }]]);
    expect(readConfig.mock.calls).toEqual([[{ signal: expect.any(AbortSignal) }]]);
    for (const read of [readDefaults, providers, readConfig])
      read.mockRejectedValue(new Error("configuration changed"));
    expect((await start(selection)).structuredContent).toEqual(accepted);
    expect(readDefaults).toHaveBeenCalledTimes(1);
    expect(providers).toHaveBeenCalledTimes(1);
    expect(readConfig).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
    await f.restart();
    f.host.harness.sdk.stub("threads.get", async () =>
      makeThreadResponse({ id: "thr_combined", projectId: "proj_a" }),
    );
    expect((await start(selection)).structuredContent).toEqual(accepted);
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["threads.get"]);
  },
);

it.each(["accepted", "unknown"] as const)(
  "preserves historical provider-only %s hashes and rejects added workspace",
  async (state) => {
    const { start, spawn } = await setup();
    const db = f.host.bb.storage.database();
    for (const [providerId, hash] of [
      ["saved", "de2c5c99311cd0154fa26c295b5562a25151b09673ebf81c679c816ecc489c91"],
      ["other", "6ce17f37c9a66529915565ea381c10fb3baa69fd758ff8057031558a23f02fa7"],
    ]) {
      const operationId = `historical-${providerId}`;
      const operationKey = `provider-${providerId}`;
      db.prepare(
        "INSERT INTO operations (id, issuer, owner, tool, key, hash, project, thread, state, created, updated, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        operationId,
        f.policy().issuer,
        "owner-1",
        "bb_start_thread",
        operationKey,
        hash,
        "proj_a",
        state === "accepted" ? "thr_combined" : null,
        state,
        Date.now(),
        Date.now(),
        "old-generation",
      );
      expect((await start({ providerId, operationKey })).structuredContent).toMatchObject({
        operationId,
        state,
        threadId: state === "accepted" ? "thr_combined" : null,
      });
      for (const workspace of ["project-folder", "worktree"])
        expect(await start({ providerId, workspace, operationKey })).toEqual({
          isError: true,
          content: [{ type: "text", text: "OPERATION_CONFLICT" }],
        });
    }
    expect(spawn.mock.calls).toEqual([]);
    expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(
      state === "accepted" ? ["threads.get", "threads.get"] : [],
    );
  },
);

it.each(["provider", "config"] as const)(
  "blocks combined dispatch after control revocation during %s",
  async (stage) => {
    const { start, providers, readConfig, spawn } = await setup();
    const ready = deferred<void>();
    if (stage === "provider")
      providers.mockImplementation(async () => {
        await ready.promise;
        return [provider("saved")];
      });
    else
      readConfig.mockImplementation(async () => {
        await ready.promise;
        return config;
      });
    const selection = { providerId: "saved", workspace: "worktree" };
    const pending = await start(selection);
    expect(pending.structuredContent.state).toBe("pending");
    f.change({ controlEnabled: false });
    ready.resolve();
    await expect
      .poll(() =>
        f.host.bb.storage
          .database()
          .prepare("SELECT state FROM operations WHERE id = ?")
          .get(pending.structuredContent.operationId),
      )
      .toEqual({ state: "failed" });
    f.change({ controlEnabled: true });
    expect((await start(selection)).structuredContent).toMatchObject({
      state: "failed",
      code: "START_NOT_DISPATCHED",
    });
    expect(spawn.mock.calls).toEqual([]);
    expect(readConfig).toHaveBeenCalledTimes(stage === "provider" ? 0 : 1);
  },
);

it.each(["project-folder", "worktree"] as const)(
  "retains provider permission checks with %s and never falls back",
  async (workspace) => {
    const { start, providers, readConfig, spawn } = await setup();
    providers.mockResolvedValue([provider("other", ["full"])]);
    expect((await start({ providerId: "other", workspace })).structuredContent).toMatchObject({
      state: "failed",
      threadId: null,
      code: "START_NOT_DISPATCHED",
    });
    expect(readConfig.mock.calls).toEqual([]);
    expect(spawn.mock.calls).toEqual([]);
    expect(providers.mock.calls).toEqual([[{ signal: expect.any(AbortSignal) }]]);
  },
);

it("shares the original deadline across defaults, provider and workspace config reads", async () => {
  const { start, readDefaults, providers, readConfig, spawn } = await setup({
    limits: { responseWaitMs: 40, sdkDeadlineMs: 5000 },
  });
  const realNow = Date.now;
  readDefaults.mockImplementation(async () => {
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 2000);
    return defaults;
  });
  providers.mockImplementation(async () => {
    vi.spyOn(Date, "now").mockImplementation(() => realNow() + 4850);
    return [provider("saved")];
  });
  const ready = deferred<SystemConfig>();
  readConfig.mockImplementation(() => ready.promise);
  const selection = { providerId: "saved", workspace: "project-folder" };
  const pending = await start(selection);
  expect(pending.structuredContent.state).toBe("pending");
  const signal = readConfig.mock.calls[0][0]?.signal;
  await expect.poll(() => signal?.aborted, { timeout: 1000 }).toBe(true);
  ready.resolve(config);
  await expect.poll(async () => (await start(selection)).structuredContent.state).toBe("failed");
  expect((await start(selection)).structuredContent.code).toBe("START_NOT_DISPATCHED");
  expect(spawn.mock.calls).toEqual([]);
});
