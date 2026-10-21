import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture, loopbackFetch, provider, project } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  vi.restoreAllMocks();
  await f?.close();
});
const input = { projectId: "proj_a", prompt: "Synthetic selection", operationKey: "select-1" };
const defaults = {
  providerId: "saved",
  model: "saved-model",
  permissionMode: "accept-edits" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "saved-tier",
};
type Provider = Awaited<ReturnType<typeof f.host.bb.sdk.providers.list>>[number];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function call(name: string, args: object, credential?: string) {
  return (await (await f.rpc("tools/call", { name, arguments: args }, credential)).json()).result;
}
const discover = (projectId = "proj_a") => call("bb_list_providers", { projectId });
async function setup(options: Parameters<typeof fixture>[1] = {}) {
  f = await fixture({}, options);
  f.change({ controlEnabled: true });
  const providers = vi.fn<typeof f.host.bb.sdk.providers.list>(async () => [
    provider("saved"),
    provider("other"),
    provider("pi", ["full"]),
  ]);
  const readDefaults = vi.fn<typeof f.host.bb.sdk.projects.defaultExecutionOptions>(
    async () => defaults,
  );
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
    makeThreadResponse({ id: "thr_selected", projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("providers.list", providers);
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", readDefaults);
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_selected", projectId: "proj_a" }),
  );
  const credential = await f.token({ scope: "bb.read bb.control" });
  return {
    providers,
    readDefaults,
    spawn,
    credential,
    start: (changes: object = {}) => call("bb_start_thread", { ...input, ...changes }, credential),
  };
}
function unavailable(result: unknown) {
  expect(result).toEqual({
    isError: true,
    content: [{ type: "text", text: "PROVIDERS_UNAVAILABLE" }],
  });
}

describe("provider discovery through MCP", () => {
  it.each(["bearer-jwt", "cloudflare-access"] as const)(
    "projects only safe fields with read-only %s credentials",
    async (mode) => {
      f = await fixture({}, {}, undefined, mode);
      const list = vi.fn<typeof f.host.bb.sdk.providers.list>(async () => [
        { ...provider("z"), available: false },
        provider("a", ["full"]),
      ]);
      f.host.harness.sdk.stub("providers.list", list);
      const result = await discover();
      const data = {
        providers: [
          { id: "a", displayName: "Name a", available: true, permissionModes: ["full"] },
          {
            id: "z",
            displayName: "Name z",
            available: false,
            permissionModes: ["auto", "accept-edits", "full"],
          },
        ],
      };
      expect(result).toEqual({
        content: [{ type: "text", text: JSON.stringify(data) }],
        structuredContent: data,
      });
      expect(list.mock.calls).toEqual([[{ signal: expect.any(AbortSignal) }]]);
      expect(f.list).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["proj_missing", "proj_personal"])(
    "denies exact nonmember %s before provider reads",
    async (id) => {
      const { providers } = await setup();
      unavailable(await discover(id));
      expect(providers).not.toHaveBeenCalled();
    },
  );
  it.each(["project", "provider", "capabilities", "modes", "overflow"])(
    "fails closed without raw data on %s failure",
    async (failure) => {
      const { providers } = await setup();
      if (failure === "project") f.list.mockRejectedValue(new Error("private project"));
      else if (failure === "provider") providers.mockRejectedValue(new Error("private provider"));
      else if (failure === "overflow")
        providers.mockResolvedValue([{ ...provider("x"), displayName: '\\"\n😀'.repeat(5000) }]);
      else
        providers.mockResolvedValue([
          {
            ...provider("x"),
            capabilities: failure === "capabilities" ? undefined : { permissionModes: ["invalid"] },
          } as unknown as Provider,
        ]);
      unavailable(await discover());
      expect(JSON.stringify(f.logs)).not.toMatch(/private|😀|secret-plugin/);
    },
  );
  it.each(["project", "provider"])("rechecks read access after the %s await", async (stage) => {
    const { providers } = await setup();
    const ready = deferred<void>();
    if (stage === "project")
      f.list.mockImplementation(async () => {
        await ready.promise;
        return [project("proj_a")];
      });
    else
      providers.mockImplementation(async () => {
        await ready.promise;
        return [provider("secret")];
      });
    const pending = discover();
    await expect
      .poll(() => (stage === "project" ? f.list.mock.calls.length : providers.mock.calls.length))
      .toBe(1);
    f.change({ owner: "revoked" });
    ready.resolve();
    unavailable(await pending);
    if (stage === "project") expect(providers).not.toHaveBeenCalled();
  });
  it.each(["project", "provider"])(
    "stops after cancellation during the %s await",
    async (stage) => {
      const { providers } = await setup();
      const ready = deferred<void>();
      if (stage === "project")
        f.list.mockImplementation(async () => {
          await ready.promise;
          return [project("proj_a")];
        });
      else
        providers.mockImplementation(async () => {
          await ready.promise;
          return [provider("secret")];
        });
      const controller = new AbortController();
      const pending = loopbackFetch(f.local + "/mcp", {
        method: "POST",
        signal: controller.signal,
        headers: {
          host: "mcp.example.org",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer " + (await f.token()),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "bb_list_providers", arguments: { projectId: "proj_a" } },
        }),
      }).catch(() => null);
      await expect
        .poll(() => (stage === "project" ? f.list.mock.calls.length : providers.mock.calls.length))
        .toBe(1);
      controller.abort();
      await pending;
      await new Promise((resolve) => setTimeout(resolve, 20));
      ready.resolve();
      await expect
        .poll(() =>
          f.logs.some(
            (entry: any) =>
              entry.tool === "bb_list_providers" && entry.code === "PROVIDERS_UNAVAILABLE",
          ),
        )
        .toBe(true);
      if (stage === "project") expect(providers).not.toHaveBeenCalled();
      else expect(providers.mock.calls[0][0]?.signal?.aborted).toBe(true);
    },
  );
  it("bounds both encoded copies including escaped Unicode instead of just the projection", async () => {
    const { providers } = await setup();
    const name = '\\"\n😀'.repeat(2500);
    const data = {
      providers: [{ id: "x", displayName: name, available: true, permissionModes: ["full"] }],
    };
    expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(28000);
    expect(
      Buffer.byteLength(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(data) }],
          structuredContent: data,
        }),
      ),
    ).toBeGreaterThan(60000);
    providers.mockResolvedValue([{ ...provider("x", ["full"]), displayName: name }]);
    unavailable(await discover());
    providers.mockResolvedValue([
      { ...provider("x", ["full"]), displayName: '\\"\n😀'.repeat(1000) },
    ]);
    const response = await f.rpc("tools/call", {
      name: "bb_list_providers",
      arguments: { projectId: "proj_a" },
    });
    const text = await response.text();
    expect(Buffer.byteLength(text)).toBeLessThan(60000);
    expect(JSON.parse(text).result.structuredContent.providers).toEqual([
      { id: "x", displayName: '\\"\n😀'.repeat(1000), available: true, permissionModes: ["full"] },
    ]);
  });
  it("strictly rejects routing and control overrides before SDK reads", async () => {
    const { providers } = await setup();
    for (const override of [
      { host: "private" },
      { environment: "private" },
      { permissionMode: "full" },
      { projectId: "" },
      { providerId: "x" },
    ]) {
      expect((await call("bb_list_providers", { projectId: "proj_a", ...override })).isError).toBe(
        true,
      );
    }
    expect(providers).not.toHaveBeenCalled();
    expect(f.list).not.toHaveBeenCalled();
  });
  it("bounds unresolved provider reads across timed-out requests", async () => {
    f = await fixture({ concurrent: 2, deadlineMs: 60 });
    const ready = deferred<Provider[]>();
    const list = vi.fn<typeof f.host.bb.sdk.providers.list>(() => ready.promise);
    f.host.harness.sdk.stub("providers.list", list);
    for (let i = 0; i < 2; i++) {
      const response = await f.rpc("tools/call", {
        name: "bb_list_providers",
        arguments: { projectId: "proj_a" },
      });
      expect(response.status).toBe(504);
    }
    unavailable(await discover());
    expect(list).toHaveBeenCalledTimes(2);
    ready.resolve([]);
  });
});

describe("explicit provider start", () => {
  it.each([undefined, "saved", "other"])(
    "sends exact execution fields for %s",
    async (providerId) => {
      const { start, spawn, providers, readDefaults } = await setup();
      const result = await start(providerId === undefined ? {} : { providerId });
      expect(result.structuredContent).toMatchObject({
        state: "accepted",
        threadId: "thr_selected",
        code: null,
      });
      const execution =
        providerId === "other" ? { providerId: "other", permissionMode: "accept-edits" } : defaults;
      expect(spawn.mock.calls[0][0]).toEqual({
        ...execution,
        projectId: "proj_a",
        prompt: input.prompt,
        environment: { type: "project-default" },
        visibility: "visible",
        origin: "plugin",
        originPluginId: "test-plugin",
        pluginMetadata: { operationId: result.structuredContent.operationId },
      });
      expect(readDefaults).toHaveBeenCalledTimes(1);
      expect(providers).toHaveBeenCalledTimes(providerId === undefined ? 0 : 1);
    },
  );
  it.each(["auto", "accept-edits", "full"] as const)(
    "never escalates %s for full-only Pi",
    async (permissionMode) => {
      const { start, spawn, readDefaults } = await setup();
      readDefaults.mockResolvedValue({ ...defaults, permissionMode });
      const result = await start({ providerId: "pi" });
      expect(result.structuredContent).toMatchObject(
        permissionMode === "full"
          ? { state: "accepted", code: null }
          : { state: "failed", code: "START_NOT_DISPATCHED", threadId: null },
      );
      if (permissionMode === "full")
        expect(spawn.mock.calls[0][0]).toMatchObject({ providerId: "pi", permissionMode: "full" });
      else expect(spawn).not.toHaveBeenCalled();
    },
  );
  it("validates capability compatibility even for the saved provider", async () => {
    const { start, providers, spawn } = await setup();
    providers.mockResolvedValue([provider("saved", ["full"])]);
    expect((await start({ providerId: "saved" })).structuredContent).toMatchObject({
      state: "failed",
      code: "START_NOT_DISPATCHED",
      threadId: null,
    });
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each([
    "absent",
    "unavailable",
    "capabilities",
    "modes",
    "reject",
    "defaults-null",
    "defaults-reject",
  ])("records safe failed operation for %s", async (failure) => {
    const { start, spawn, providers, readDefaults } = await setup();
    if (failure === "absent") providers.mockResolvedValue([]);
    if (failure === "unavailable")
      providers.mockResolvedValue([{ ...provider("saved"), available: false }]);
    if (failure === "capabilities" || failure === "modes")
      providers.mockResolvedValue([
        {
          ...provider("saved"),
          capabilities: failure === "capabilities" ? undefined : { permissionModes: "full" },
        } as unknown as Provider,
      ]);
    if (failure === "reject") providers.mockRejectedValue(new Error("private provider failure"));
    if (failure === "defaults-null") readDefaults.mockResolvedValue(null);
    if (failure === "defaults-reject")
      readDefaults.mockRejectedValue(new Error("private defaults failure"));
    const result = await start({ providerId: "saved" });
    expect(result.structuredContent).toMatchObject({
      state: "failed",
      code: "START_NOT_DISPATCHED",
      threadId: null,
    });
    expect(JSON.stringify(result)).not.toContain("private");
    expect(await start({ providerId: "saved" })).toEqual(result);
    expect(spawn).not.toHaveBeenCalled();
    expect(readDefaults).toHaveBeenCalledTimes(1);
    expect(providers).toHaveBeenCalledTimes(failure.startsWith("defaults-") ? 0 : 1);
  });
  it.each([
    { providerId: " " },
    { providerId: "x".repeat(201) },
    { providerId: "saved", model: "override" },
    { providerId: "saved", reasoningLevel: "high" },
    { providerId: "saved", serviceTier: "override" },
  ])("rejects invalid selection or privileged override %j", async (change) => {
    const { start, readDefaults, providers } = await setup();
    expect((await start(change)).isError).toBe(true);
    expect(readDefaults).not.toHaveBeenCalled();
    expect(providers).not.toHaveBeenCalled();
  });
  it("normalizes explicit IDs and protects concurrent duplicate keys and changed selections", async () => {
    const { start, providers, readDefaults, spawn } = await setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => start({ providerId: " saved " })),
    );
    expect(results[0].structuredContent.state).toBe("accepted");
    for (const result of results) expect(result).toEqual(results[0]);
    expect(await start({ providerId: "saved" })).toEqual(results[0]);
    for (const change of [{}, { providerId: "other" }])
      expect(await start(change)).toEqual({
        isError: true,
        content: [{ type: "text", text: "OPERATION_CONFLICT" }],
      });
    expect(providers).toHaveBeenCalledTimes(1);
    expect(readDefaults).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
  it("replays the exact legacy three-element hash without defaults, providers or dispatch", async () => {
    const { start, providers, readDefaults, spawn } = await setup();
    const hash = createHash("sha256")
      .update(JSON.stringify(["proj_a", "Synthetic selection", null]))
      .digest("hex");
    const stamp = Date.now();
    f.host.bb.storage
      .database()
      .prepare(
        "INSERT INTO operations (id, issuer, owner, tool, key, hash, project, state, code, created, updated, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "historical",
        f.policy().issuer,
        "owner-1",
        "bb_start_thread",
        input.operationKey,
        hash,
        "proj_a",
        "failed",
        "START_NOT_DISPATCHED",
        stamp,
        stamp,
        "old-generation",
      );
    expect((await start()).structuredContent).toMatchObject({
      operationId: "historical",
      state: "failed",
      code: "START_NOT_DISPATCHED",
    });
    expect((await start({ providerId: "saved" })).content).toEqual([
      { type: "text", text: "OPERATION_CONFLICT" },
    ]);
    expect(providers).not.toHaveBeenCalled();
    expect(readDefaults).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
  it.each(["defaults", "provider"])(
    "rechecks control and absolute deadline after %s, before any further SDK work",
    async (stage) => {
      const { start, providers, readDefaults, spawn, credential } = await setup({
        limits: { responseWaitMs: 3000, sdkDeadlineMs: 5000 },
      });
      const ready = deferred<void>();
      if (stage === "defaults")
        readDefaults.mockImplementation(async () => {
          await ready.promise;
          return defaults;
        });
      else
        providers.mockImplementation(async () => {
          await ready.promise;
          return [provider("saved")];
        });
      const pending = start({ providerId: "saved" });
      await expect
        .poll(() =>
          stage === "defaults" ? readDefaults.mock.calls.length : providers.mock.calls.length,
        )
        .toBe(1);
      const realNow = Date.now;
      const now = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 6000);
      ready.resolve();
      const result = await pending;
      now.mockRestore();
      expect(result.structuredContent).toMatchObject({
        state: "failed",
        code: "START_NOT_DISPATCHED",
      });
      expect(spawn).not.toHaveBeenCalled();
      if (stage === "defaults") expect(providers).not.toHaveBeenCalled();
      else expect(providers.mock.calls[0][0]?.signal).toBeInstanceOf(AbortSignal);
      expect(
        (await call("bb_start_thread", { ...input, providerId: "saved" }, credential))
          .structuredContent.state,
      ).toBe("failed");
    },
  );
  it.each(["defaults", "provider"])(
    "blocks control revocation across the %s read",
    async (stage) => {
      const { start, providers, readDefaults, spawn } = await setup({
        limits: { responseWaitMs: 3000 },
      });
      const ready = deferred<void>();
      if (stage === "defaults")
        readDefaults.mockImplementation(async () => {
          await ready.promise;
          return defaults;
        });
      else
        providers.mockImplementation(async () => {
          await ready.promise;
          return [provider("saved")];
        });
      const pending = start({ providerId: "saved" });
      await expect
        .poll(() =>
          stage === "defaults" ? readDefaults.mock.calls.length : providers.mock.calls.length,
        )
        .toBe(1);
      f.change({ controlEnabled: false });
      ready.resolve();
      expect((await pending).content).toEqual([{ type: "text", text: "OPERATION_UNAVAILABLE" }]);
      f.change({ controlEnabled: true });
      expect((await start({ providerId: "saved" })).structuredContent.state).toBe("failed");
      expect(spawn).not.toHaveBeenCalled();
      if (stage === "defaults") expect(providers).not.toHaveBeenCalled();
    },
  );
  it.each(["defaults", "provider"])("blocks token expiry across the %s read", async (stage) => {
    const { providers, readDefaults, spawn } = await setup({ limits: { responseWaitMs: 3000 } });
    const credential = await f.token({
      scope: "bb.read bb.control",
      exp: Math.floor(Date.now() / 1000) + 30,
    });
    const ready = deferred<void>();
    if (stage === "defaults")
      readDefaults.mockImplementation(async () => {
        await ready.promise;
        return defaults;
      });
    else
      providers.mockImplementation(async () => {
        await ready.promise;
        return [provider("saved")];
      });
    const pending = call("bb_start_thread", { ...input, providerId: "saved" }, credential);
    await expect
      .poll(() =>
        stage === "defaults" ? readDefaults.mock.calls.length : providers.mock.calls.length,
      )
      .toBe(1);
    const realNow = Date.now;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 31000);
    ready.resolve();
    expect((await pending).content).toEqual([{ type: "text", text: "OPERATION_UNAVAILABLE" }]);
    clock.mockRestore();
    expect(spawn).not.toHaveBeenCalled();
    if (stage === "defaults") expect(providers).not.toHaveBeenCalled();
  });
  it.each(["defaults", "provider"])(
    "passes cancellation and never spawns after abort during %s",
    async (stage) => {
      const { start, providers, readDefaults, spawn, credential } = await setup({
        limits: { responseWaitMs: 3000 },
      });
      const ready = deferred<void>();
      if (stage === "defaults")
        readDefaults.mockImplementation(async () => {
          await ready.promise;
          return defaults;
        });
      else
        providers.mockImplementation(async () => {
          await ready.promise;
          return [provider("saved")];
        });
      const controller = new AbortController();
      const pending = loopbackFetch(f.local + "/mcp", {
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
          params: { name: "bb_start_thread", arguments: { ...input, providerId: "saved" } },
        }),
      }).catch(() => null);
      await expect
        .poll(() =>
          stage === "defaults" ? readDefaults.mock.calls.length : providers.mock.calls.length,
        )
        .toBe(1);
      controller.abort();
      await pending;
      const readSignal =
        stage === "defaults"
          ? readDefaults.mock.calls[0][0].signal
          : providers.mock.calls[0][0]?.signal;
      await expect.poll(() => readSignal?.aborted).toBe(true);
      ready.resolve();
      expect((await start({ providerId: "saved" })).structuredContent.state).toBe("failed");
      expect(spawn).not.toHaveBeenCalled();
      if (stage === "defaults") expect(providers).not.toHaveBeenCalled();
    },
  );
  it("gives provider reads only the remaining absolute SDK budget", async () => {
    const { start, providers, readDefaults, spawn } = await setup({
      limits: { responseWaitMs: 3000, sdkDeadlineMs: 5000 },
    });
    const ready = deferred<Provider[]>();
    const realNow = Date.now;
    readDefaults.mockImplementation(async () => {
      vi.spyOn(Date, "now").mockImplementation(() => realNow() + 4850);
      return defaults;
    });
    providers.mockImplementation(() => ready.promise);
    const pending = start({ providerId: "saved" });
    await expect.poll(() => providers.mock.calls.length).toBe(1);
    const signal = providers.mock.calls[0][0]?.signal;
    await expect.poll(() => signal?.aborted, { timeout: 1000 }).toBe(true);
    ready.resolve([provider("saved")]);
    expect((await pending).structuredContent).toMatchObject({
      state: "failed",
      code: "START_NOT_DISPATCHED",
    });
    expect(spawn).not.toHaveBeenCalled();
  });
  it("shares one pending explicit selection read between concurrent duplicate calls", async () => {
    const { start, providers, spawn, readDefaults } = await setup({
      limits: { responseWaitMs: 50 },
    });
    const ready = deferred<Provider[]>();
    providers.mockImplementation(() => ready.promise);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => start({ providerId: "saved" })),
    );
    for (const result of results)
      expect(result.structuredContent).toMatchObject({
        state: "pending",
        operationId: results[0].structuredContent.operationId,
      });
    expect(providers).toHaveBeenCalledTimes(1);
    expect(readDefaults).toHaveBeenCalledTimes(1);
    ready.resolve([provider("saved")]);
    await expect
      .poll(async () => (await start({ providerId: "saved" })).structuredContent.state)
      .toBe("accepted");
    expect(spawn).toHaveBeenCalledTimes(1);
    const hash = createHash("sha256")
      .update(JSON.stringify(["proj_a", "Synthetic selection", null, "saved"]))
      .digest("hex");
    expect(
      f.host.bb.storage
        .database()
        .prepare("SELECT hash FROM operations WHERE id = ?")
        .get(results[0].structuredContent.operationId),
    ).toEqual({ hash });
  });
  it("never dispatches an old generation after provider discovery settles", async () => {
    const { start, providers, spawn } = await setup({ limits: { responseWaitMs: 50 } });
    const ready = deferred<Provider[]>();
    providers.mockImplementation(() => ready.promise);
    const pending = await start({ providerId: "saved" });
    expect(pending.structuredContent.state).toBe("pending");
    await f.restart();
    ready.resolve([provider("saved")]);
    const replay = await start({ providerId: "saved" });
    expect(replay.structuredContent).toMatchObject({
      state: "unknown",
      code: "PLUGIN_STOPPED",
      operationId: pending.structuredContent.operationId,
    });
    expect(providers).toHaveBeenCalledTimes(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toEqual([]);
  });
  it("retains unknown outcomes once an explicit spawn begins", async () => {
    const { start, spawn, providers } = await setup();
    spawn.mockRejectedValue(new Error("private post-spawn failure"));
    const result = await start({ providerId: "other" });
    expect(result.structuredContent).toMatchObject({
      state: "unknown",
      code: "BB_OUTCOME_UNKNOWN",
    });
    expect(await start({ providerId: "other" })).toEqual(result);
    expect(providers).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
