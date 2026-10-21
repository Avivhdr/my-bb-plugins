import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { readConfig, settingsDefinition } from "../config.js";
import {
  operationMigration,
  operationSubmissionMigration,
  operationStopMigration,
  operationResolutionMigration,
} from "../operations.js";
import { fixture, project } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const defaults = {
  providerId: "fixture",
  model: "fixture",
  permissionMode: "accept-edits" as const,
  reasoningLevel: "medium" as const,
  serviceTier: "default",
};
const modes = ["bearer-jwt", "cloudflare-access"] as const;
const inputs = {
  bb_start_thread: { projectId: "proj_future", prompt: "Synthetic", operationKey: "start" },
  bb_send_message: { threadId: "thr_fixture", message: "Synthetic", operationKey: "send" },
  bb_stop_thread: { threadId: "thr_fixture", operationKey: "stop" },
};
async function call(name: string, args: object) {
  const token = await f.token({ scope: "bb.read bb.control" });
  return (await (await f.rpc("tools/call", { name, arguments: args }, token)).json()).result;
}
function denied(result: unknown, text = "OPERATION_UNAVAILABLE") {
  expect(result).toEqual({ isError: true, content: [{ type: "text", text }] });
}
async function setup(mode: (typeof modes)[number]) {
  f = await fixture({}, {}, undefined, mode);
  f.change({ controlEnabled: true, accessPermission: "read-control" });
}

describe.each(modes)("%s project access", (mode) => {
  it.each([undefined, "", "bad,path", "proj_deleted", "proj_personal", 42, null, { bad: true }])(
    "ignores legacy grants without mutating settings: %j",
    async (projects) => {
      await setup(mode);
      const valid = { ...f.policy(), port: 38991 };
      const expected = readConfig(valid);
      expect(expected).not.toBeNull();
      const raw = Object.freeze({ ...valid, projects });
      expect(readConfig(raw)).toEqual(expected);
      expect(Object.hasOwn(readConfig(raw) ?? {}, "projects")).toBe(false);
      expect(raw.projects).toBe(projects);
      expect(Object.hasOwn(settingsDefinition, "projects")).toBe(false);
      expect(readConfig({ ...raw, unrelated: true })).toBeNull();
      expect(readConfig({ ...raw, owner: "" })).toBeNull();
      expect(readConfig({ ...raw, authMode: "invalid" })).toBeNull();
    },
  );

  it("filters a faulty adapter before sorting, pagination and projection without excluding standard Personal names", async () => {
    await setup(mode);
    f.list.mockResolvedValue([
      project("proj_personal", "Private singleton"),
      project("", "Missing ID"),
      project("proj_z", "Personal"),
      project("proj_a", "Ordinary"),
    ]);
    expect((await call("bb_list_projects", { limit: 1 })).structuredContent).toEqual({
      projects: [{ id: "proj_a", name: "Ordinary" }],
      nextCursor: "1",
    });
    expect((await call("bb_list_projects", { limit: 1, cursor: "1" })).structuredContent).toEqual({
      projects: [{ id: "proj_z", name: "Personal" }],
      nextCursor: null,
    });
  });

  it.each(["proj_future", "proj_personal_other"])(
    "reads and controls new standard project %s without grants",
    async (projectId) => {
      await setup(mode);
      f.list.mockResolvedValue([project(projectId, "Personal")]);
      expect((await call("bb_list_projects", {})).structuredContent).toEqual({
        projects: [{ id: projectId, name: "Personal" }],
        nextCursor: null,
      });
      const thread = makeThreadResponse({ id: "thr_fixture", projectId });
      f.host.harness.sdk.stub("threads.list", async () => [
        {
          ...thread,
          activity: {
            activeBackgroundAgentCount: 0,
            activeBackgroundCommandCount: 0,
            activeGoalCount: 0,
            activePlanModeCount: 0,
            activeWorkflowCount: 0,
          },
        },
      ]);
      f.host.harness.sdk.stub("threads.get", async () => thread);
      f.host.harness.sdk.stub("threads.output", async () => ({ output: "Fixture output" }));
      f.host.harness.sdk.stub("threads.interactions.list", async () => []);
      f.host.harness.sdk.stub("threads.queuedMessages.list", async () => []);
      f.host.harness.sdk.stub("projects.defaultExecutionOptions", async () => defaults);
      f.host.harness.sdk.stub("threads.spawn", async () => thread);
      f.host.harness.sdk.stub("threads.send", async () => ({ ok: true, delivery: "sent" }));
      f.host.harness.sdk.stub("threads.stop", async () => ({ ok: true }));
      expect((await call("bb_list_threads", { projectId })).structuredContent.threads).toHaveLength(
        1,
      );
      expect(
        (await call("bb_get_thread", { projectId, threadId: thread.id })).structuredContent,
      ).toMatchObject({ id: thread.id, assistantOutput: { text: "Fixture output" } });
      for (const tool of ["bb_start_thread", "bb_send_message", "bb_stop_thread"] as const) {
        const args = tool === "bb_start_thread" ? { ...inputs[tool], projectId } : inputs[tool];
        const result = (await call(tool, args)).structuredContent;
        expect(result).toMatchObject({ state: "accepted", threadId: thread.id });
        expect(
          (await call("bb_get_operation", { operationId: result.operationId })).structuredContent,
        ).toEqual(result);
        expect((await call(tool, args)).structuredContent).toEqual(result);
      }
      for (const path of ["threads.spawn", "threads.send", "threads.stop"] as const)
        expect(f.host.harness.inspection.sdk.callsTo(path)).toHaveLength(1);
    },
  );

  it("blocks Personal list, get and start before any SDK read, defaults, claim or dispatch", async () => {
    await setup(mode);
    denied(await call("bb_list_threads", { projectId: "proj_personal" }), "THREAD_UNAVAILABLE");
    denied(
      await call("bb_get_thread", { projectId: "proj_personal", threadId: "thr_fixture" }),
      "THREAD_UNAVAILABLE",
    );
    denied(
      await call("bb_start_thread", { ...inputs.bb_start_thread, projectId: "proj_personal" }),
    );
    expect(f.host.harness.inspection.sdk.calls).toEqual([]);
    const local = await f.host.harness.behavior.runCli(["operations", "--json"]);
    expect(JSON.parse(local.stdout).operations).toEqual([]);
  });

  it.each(["bb_send_message", "bb_stop_thread"] as const)(
    "blocks Personal %s after membership lookup without claim or dispatch",
    async (tool) => {
      await setup(mode);
      f.host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({
          id: "thr_fixture",
          projectId: "proj_personal",
        }),
      );
      denied(await call(tool, inputs[tool]));
      expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["threads.get"]);
      const local = await f.host.harness.behavior.runCli(["operations", "--json"]);
      expect(JSON.parse(local.stdout).operations).toEqual([]);
    },
  );

  it.each(["bb_send_message", "bb_stop_thread"] as const)(
    "blocks movement to Personal before %s dispatch and during cached lookup",
    async (tool) => {
      await setup(mode);
      const standard = makeThreadResponse({ id: "thr_fixture", projectId: "proj_future" });
      const personal = makeThreadResponse({ id: "thr_fixture", projectId: "proj_personal" });
      const get = vi
        .fn<typeof f.host.bb.sdk.threads.get>()
        .mockResolvedValue(personal)
        .mockResolvedValueOnce(standard)
        .mockResolvedValueOnce(personal);
      f.host.harness.sdk.stub("threads.get", get);
      denied(await call(tool, inputs[tool]));
      expect(
        f.host.harness.inspection.sdk.callsTo(
          tool === "bb_send_message" ? "threads.send" : "threads.stop",
        ),
      ).toEqual([]);
      get.mockResolvedValue(standard);
      const failed = (await call(tool, inputs[tool])).structuredContent;
      expect(failed).toMatchObject({ state: "failed", threadId: "thr_fixture" });
      get.mockResolvedValueOnce(standard).mockResolvedValueOnce(personal);
      denied(await call(tool, inputs[tool]));
      get.mockResolvedValue(personal);
      denied(await call("bb_get_operation", { operationId: failed.operationId }));
      expect(
        f.host.harness.inspection.sdk.callsTo(
          tool === "bb_send_message" ? "threads.send" : "threads.stop",
        ),
      ).toEqual([]);
    },
  );

  it.each(["bb_start_thread", "bb_send_message", "bb_stop_thread"] as const)(
    "denies %s result and cached replay after dispatch moves a thread to Personal",
    async (tool) => {
      await setup(mode);
      const standard = makeThreadResponse({ id: "thr_fixture", projectId: "proj_future" });
      const personal = makeThreadResponse({ id: "thr_fixture", projectId: "proj_personal" });
      const get = vi.fn<typeof f.host.bb.sdk.threads.get>().mockResolvedValue(standard);
      f.host.harness.sdk.stub("threads.get", get);
      f.host.harness.sdk.stub("projects.defaultExecutionOptions", async () => defaults);
      f.host.harness.sdk.stub("threads.interactions.list", async () => []);
      f.host.harness.sdk.stub("threads.queuedMessages.list", async () => []);
      f.host.harness.sdk.stub("threads.spawn", async () => {
        get.mockResolvedValue(personal);
        return standard;
      });
      f.host.harness.sdk.stub("threads.send", async () => {
        get.mockResolvedValue(personal);
        return { ok: true, delivery: "sent" };
      });
      f.host.harness.sdk.stub("threads.stop", async () => {
        get.mockResolvedValue(personal);
        return { ok: true };
      });
      denied(await call(tool, inputs[tool]));
      const local = await f.host.harness.behavior.runCli(["operations", "--json"]);
      const row = JSON.parse(local.stdout).operations[0];
      expect(row).toMatchObject({ tool, state: "accepted", threadId: "thr_fixture" });
      denied(await call("bb_get_operation", { operationId: row.operationId }));
      if (tool !== "bb_start_thread") get.mockResolvedValueOnce(standard);
      denied(await call(tool, inputs[tool]));
      const path =
        tool === "bb_start_thread"
          ? "threads.spawn"
          : tool === "bb_send_message"
            ? "threads.send"
            : "threads.stop";
      expect(f.host.harness.inspection.sdk.callsTo(path)).toHaveLength(1);
    },
  );

  it("denies output after movement to Personal", async () => {
    await setup(mode);
    const get = vi
      .fn<typeof f.host.bb.sdk.threads.get>()
      .mockResolvedValueOnce(makeThreadResponse({ id: "thr_fixture", projectId: "proj_future" }))
      .mockResolvedValue(makeThreadResponse({ id: "thr_fixture", projectId: "proj_personal" }));
    f.host.harness.sdk.stub("threads.get", get);
    f.host.harness.sdk.stub("threads.output", async () => ({ output: "Must not escape" }));
    f.host.harness.sdk.stub("threads.interactions.list", async () => []);
    denied(
      await call("bb_get_thread", { projectId: "proj_future", threadId: "thr_fixture" }),
      "THREAD_UNAVAILABLE",
    );
  });

  it.each(["bb_send_message", "bb_stop_thread"] as const)(
    "denies %s replay of a recorded Personal project even when the thread is now standard",
    async (tool) => {
      const args = inputs[tool];
      const hash = createHash("sha256")
        .update(JSON.stringify("message" in args ? [args.threadId, args.message] : [args.threadId]))
        .digest("hex");
      f = await fixture(
        {},
        {},
        (host) => {
          const db = host.bb.storage.database();
          host.bb.storage.migrate(db, [
            operationMigration,
            operationSubmissionMigration,
            operationStopMigration,
            operationResolutionMigration,
          ]);
          db.prepare(
            "INSERT INTO operations (id, issuer, owner, tool, key, hash, project, thread, state, created, updated, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(
            "old-personal",
            "https://issuer.example.org" + (mode === "bearer-jwt" ? "/realm" : ""),
            "owner-1",
            tool,
            args.operationKey,
            hash,
            "proj_personal",
            args.threadId,
            "unknown",
            Date.now(),
            Date.now(),
            "old",
          );
        },
        mode,
      );
      f.change({ controlEnabled: true, accessPermission: "read-control" });
      f.host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: args.threadId, projectId: "proj_future" }),
      );
      denied(await call("bb_get_operation", { operationId: "old-personal" }));
      expect(f.host.harness.inspection.sdk.calls).toEqual([]);
      denied(await call(tool, args));
      expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["threads.get"]);
      await f.restart();
      f.host.harness.sdk.stub("threads.get", async () =>
        makeThreadResponse({ id: args.threadId, projectId: "proj_future" }),
      );
      denied(await call(tool, args));
      const local = await f.host.harness.behavior.runCli([
        "operations",
        "--operation",
        "old-personal",
        "--json",
      ]);
      expect(JSON.parse(local.stdout).operations[0]).toMatchObject({
        tool,
        projectId: "proj_personal",
        state: "unknown",
      });
      expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["threads.get"]);
    },
  );

  it.each([null, "thr_fixture"])(
    "retains old Personal record with thread %s for local resolution and restart protection, but denies remote poll and replay",
    async (thread) => {
      const args = { ...inputs.bb_start_thread, projectId: "proj_personal" };
      const hash = createHash("sha256")
        .update(JSON.stringify([args.projectId, args.prompt, null]))
        .digest("hex");
      f = await fixture(
        {},
        {},
        (host) => {
          const db = host.bb.storage.database();
          host.bb.storage.migrate(db, [
            operationMigration,
            operationSubmissionMigration,
            operationStopMigration,
            operationResolutionMigration,
          ]);
          db.prepare(
            "INSERT INTO operations (id, issuer, owner, tool, key, hash, project, thread, state, created, updated, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(
            "old-personal",
            "https://issuer.example.org" + (mode === "bearer-jwt" ? "/realm" : ""),
            "owner-1",
            "bb_start_thread",
            args.operationKey,
            hash,
            args.projectId,
            thread,
            "unknown",
            Date.now(),
            Date.now(),
            "old",
          );
        },
        mode,
      );
      f.change({ controlEnabled: true, accessPermission: "read-control" });
      denied(await call("bb_get_operation", { operationId: "old-personal" }));
      denied(await call("bb_start_thread", args));
      expect(f.host.harness.inspection.sdk.calls).toEqual([]);
      const inspect = await f.host.harness.behavior.runCli([
        "operations",
        "--operation",
        "old-personal",
        "--json",
      ]);
      expect(JSON.parse(inspect.stdout).operations[0]).toMatchObject({
        projectId: "proj_personal",
        state: "unknown",
        threadId: thread,
      });
      const resolution = await f.host.harness.behavior.runCli([
        "resolve-operation",
        "old-personal",
        "--outcome",
        "failed",
        "--project",
        "proj_personal",
        "--verified",
        "--json",
        ...(thread ? ["--thread", thread] : []),
      ]);
      expect(resolution.exitCode).toBe(0);
      await f.restart();
      denied(await call("bb_get_operation", { operationId: "old-personal" }));
      denied(await call("bb_start_thread", args));
      const after = await f.host.harness.behavior.runCli([
        "operations",
        "--operation",
        "old-personal",
        "--json",
      ]);
      expect(JSON.parse(after.stdout).operations[0]).toMatchObject({
        operationKey: args.operationKey,
        state: "failed",
        code: "OWNER_VERIFIED_FAILED",
      });
      expect(f.host.harness.inspection.sdk.calls).toEqual([]);
    },
  );
});
