import { afterEach, expect, it, vi } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture } from "./fixtures.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});
const input = { projectId: "proj_a", prompt: "Do fixture work", operationKey: "start-1" };
it("starts one ordinary thread through authenticated MCP and polls acceptance without repeating work", async () => {
  f = await fixture();
  f.change({ controlEnabled: true });
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(async () =>
    makeThreadResponse({ id: "thr_started", projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_started", projectId: "proj_a" }),
  );
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", async () => ({
    providerId: "fixture",
    model: "fixture-model",
    permissionMode: "accept-edits",
    reasoningLevel: "medium",
    serviceTier: "default",
  }));
  const token = await f.token({ scope: "bb.read bb.control" });
  const reply = await (
    await f.rpc("tools/call", { name: "bb_start_thread", arguments: input }, token)
  ).json();
  expect(reply.result?.structuredContent).toMatchObject({
    state: "accepted",
    threadId: "thr_started",
  });
  const operationId = reply.result.structuredContent.operationId;
  const poll = await (
    await f.rpc("tools/call", { name: "bb_get_operation", arguments: { operationId } })
  ).json();
  expect(poll.result.structuredContent).toMatchObject({
    operationId,
    state: "accepted",
    threadId: "thr_started",
  });
  const replay = await (
    await f.rpc("tools/call", { name: "bb_start_thread", arguments: input }, token)
  ).json();
  expect(replay.result.structuredContent).toEqual(reply.result.structuredContent);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0][0]).toMatchObject({
    projectId: "proj_a",
    environment: { type: "project-default" },
    visibility: "visible",
    prompt: input.prompt,
    pluginMetadata: { operationId },
  });
  expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).not.toContain("plugins.callRpc");
});

it("concurrent identical keys dispatch once and changed input conflicts", async () => {
  f = await fixture({}, { limits: { responseWaitMs: 50 } });
  f.change({ controlEnabled: true });
  let complete!: (value: ReturnType<typeof makeThreadResponse>) => void;
  const spawn = vi.fn<typeof f.host.bb.sdk.threads.spawn>(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  f.host.harness.sdk.stub("threads.spawn", spawn);
  f.host.harness.sdk.stub("projects.defaultExecutionOptions", async () => ({
    providerId: "fixture",
    model: "fixture-model",
    permissionMode: "accept-edits",
    reasoningLevel: "medium",
    serviceTier: "default",
  }));
  const credential = await f.token({ scope: "bb.read bb.control" });
  const responses = await Promise.all(
    Array.from({ length: 6 }, async () =>
      (await f.rpc("tools/call", { name: "bb_start_thread", arguments: input }, credential)).json(),
    ),
  );
  const ids = responses.map((reply) => reply.result.structuredContent.operationId);
  expect(new Set(ids).size).toBe(1);
  expect(responses.every((reply) => reply.result.structuredContent.state === "pending")).toBe(true);
  expect(spawn).toHaveBeenCalledTimes(1);
  const conflict = await (
    await f.rpc(
      "tools/call",
      { name: "bb_start_thread", arguments: { ...input, prompt: "Different" } },
      credential,
    )
  ).json();
  expect(conflict.result.content[0].text).toBe("OPERATION_CONFLICT");
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_started", projectId: "proj_a" }),
  );
  complete(makeThreadResponse({ id: "thr_started", projectId: "proj_a" }));
  await expect
    .poll(
      async () =>
        (
          await (
            await f.rpc("tools/call", {
              name: "bb_get_operation",
              arguments: { operationId: ids[0] },
            })
          ).json()
        ).result.structuredContent.state,
    )
    .toBe("accepted");
  expect(spawn).toHaveBeenCalledTimes(1);
});
