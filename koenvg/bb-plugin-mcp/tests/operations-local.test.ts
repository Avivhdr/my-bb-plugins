import { afterEach, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import {
  operationMigration,
  operationSubmissionMigration,
  operationStopMigration,
} from "../operations.js";

let host: ReturnType<typeof createFakePluginHost>;
afterEach(async () => {
  await host?.harness.lifecycle.dispose();
});

function seed(
  count = 1,
  options: { tool?: string; thread?: string; state?: string; issuer?: string; owner?: string } = {},
) {
  host = createFakePluginHost();
  const db = host.bb.storage.database();
  host.bb.storage.migrate(db, [
    operationMigration,
    operationSubmissionMigration,
    operationStopMigration,
  ]);
  for (let i = 0; i < count; i++) {
    db.prepare(`INSERT INTO operations (id, issuer, owner, tool, key, hash, project, thread, state, created, updated, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      `op-${String(i).padStart(3, "0")}`,
      options.issuer ?? "https://issuer.example.org",
      options.owner ?? "fixture-owner",
      options.tool ?? "bb_start_thread",
      `key-${i}`,
      "input-hash-not-content",
      "proj_a",
      options.thread ?? null,
      options.state ?? "pending",
      100,
      200,
      "old-generation",
    );
  }
}
async function cli(argv: string[]) {
  return host.harness.behavior.runCli(argv);
}
async function operations(argv: string[] = []) {
  const reply = await cli(["operations", ...argv, "--json"]);
  expect(reply.exitCode).toBe(0);
  return JSON.parse(reply.stdout);
}

it("lists bounded local summaries and inspects one record without BB calls or content copies", async () => {
  seed(51);
  await plugin(host.bb);
  const first = await operations(["--limit", "50"]);
  expect(first.operations).toHaveLength(50);
  expect(first.nextCursor).toBe("op-049");
  expect(first.operations[0]).toEqual({
    operationId: "op-000",
    issuer: "https://issuer.example.org",
    owner: "fixture-owner",
    tool: "bb_start_thread",
    operationKey: "key-0",
    projectId: "proj_a",
    threadId: null,
    state: "unknown",
    code: "PLUGIN_RESTART",
    createdAt: 100,
    updatedAt: expect.any(Number),
    resolvedAt: null,
    active: false,
  });
  const next = await operations(["--cursor", first.nextCursor]);
  expect(next.operations).toHaveLength(1);
  expect(next.nextCursor).toBeNull();
  const one = await operations(["--operation", "op-000"]);
  expect(one.operations).toEqual([first.operations[0]]);
  expect(JSON.stringify(first)).not.toMatch(/input-hash|prompt|message|generation|token|output/);
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});

it("records a verified acceptance locally and retains it across plugin restart without SDK calls", async () => {
  seed();
  await plugin(host.bb);
  const before = (await operations()).operations[0];
  const resolved = await cli([
    "resolve-operation",
    "op-000",
    "--outcome",
    "accepted",
    "--project",
    "proj_a",
    "--thread",
    "thr_verified",
    "--verified",
    "--json",
  ]);
  expect(resolved.exitCode).toBe(0);
  const after = (await operations()).operations[0];
  expect(after).toMatchObject({
    ...before,
    state: "accepted",
    code: "OWNER_VERIFIED_ACCEPTED",
    threadId: "thr_verified",
    updatedAt: expect.any(Number),
    resolvedAt: expect.any(Number),
  });
  expect(host.harness.inspection.sdk.calls).toEqual([]);
  host = await host.harness.lifecycle.reload(plugin);
  expect((await operations()).operations[0]).toEqual(after);
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});

it.each([
  ["--outcome", "unknown", "--project", "proj_a", "--verified"],
  ["--outcome", "accepted", "--project", "proj_a", "--thread", "thr_verified"],
  ["--outcome", "accepted", "--project", "proj_other", "--thread", "thr_verified", "--verified"],
  ["--outcome", "accepted", "--project", "proj_a", "--verified"],
  ["--outcome", "failed", "--project", "proj_a", "--thread", "thr_unrelated", "--verified"],
  [
    "--outcome",
    "accepted",
    "--project",
    "proj_a",
    "--thread",
    "thr_verified",
    "--delivery",
    "sent",
    "--verified",
  ],
  [
    "--outcome",
    "accepted",
    "--project",
    "proj_a",
    "--thread",
    "thr_verified",
    "--verified",
    "--verified",
  ],
  ["--outcome", "failed", "--project", "proj_a", "--verified", "--approval"],
])("rejects invalid local resolution without changing the record: %j", async (...args) => {
  seed();
  await plugin(host.bb);
  const before = await operations();
  expect((await cli(["resolve-operation", "op-000", ...args, "--json"])).exitCode).toBe(1);
  expect(await operations()).toEqual(before);
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});

it.each(["bb_send_message", "bb_stop_thread"])(
  "requires the existing target and consistent result for %s",
  async (tool) => {
    seed(1, { tool, thread: "thr_original" });
    await plugin(host.bb);
    const before = await operations();
    const common = [
      "resolve-operation",
      "op-000",
      "--outcome",
      "accepted",
      "--project",
      "proj_a",
      "--verified",
    ];
    const result = tool === "bb_send_message" ? ["--delivery", "queued"] : [];
    for (const target of [[], ["--thread", "thr_other"]]) {
      expect((await cli([...common, ...target, ...result])).exitCode).toBe(1);
      expect(await operations()).toEqual(before);
    }
    if (tool === "bb_send_message") {
      expect((await cli([...common, "--thread", "thr_original"])).exitCode).toBe(1);
      expect(await operations()).toEqual(before);
    }
    expect((await cli([...common, "--thread", "thr_original", ...result])).exitCode).toBe(0);
    const after = await operations();
    expect((await cli([...common, "--thread", "thr_original", ...result])).stderr).toBe(
      "OPERATION_ALREADY_FINAL",
    );
    expect(await operations()).toEqual(after);
    expect(host.harness.inspection.sdk.calls).toEqual([]);
  },
);

it("records verified failure without inventing a thread or a replay opportunity", async () => {
  seed();
  await plugin(host.bb);
  expect(
    (
      await cli([
        "resolve-operation",
        "op-000",
        "--outcome",
        "failed",
        "--project",
        "proj_a",
        "--verified",
      ])
    ).exitCode,
  ).toBe(0);
  expect((await operations()).operations[0]).toMatchObject({
    state: "failed",
    threadId: null,
    code: "OWNER_VERIFIED_FAILED",
    resolvedAt: expect.any(Number),
  });
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});

it.each([
  ["--limit", "0"],
  ["--limit", "51"],
  ["--limit", "1.5"],
  ["--limit", "1e1"],
  ["--cursor"],
  ["--operation", "missing"],
  ["--operation", "op-000", "--cursor", "op-000"],
  ["--json", "--json"],
  ["--prompt", "secret"],
])("rejects malformed diagnostic input: %j", async (...args) => {
  seed();
  await plugin(host.bb);
  expect((await cli(["operations", ...args])).exitCode).toBe(1);
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});

it("bounds encoded diagnostic output and retains a continuation with long identities", async () => {
  seed(50, { issuer: "https://issuer.example.org/" + "界".repeat(1900), owner: "界".repeat(256) });
  await plugin(host.bb);
  for (const flags of [[], ["--json"]]) {
    const result = await cli(["operations", ...flags]);
    expect(result.exitCode).toBe(0);
    expect(Buffer.byteLength(result.stdout)).toBeLessThan(65536);
    const page = JSON.parse(result.stdout);
    expect(page.operations.length).toBeGreaterThan(0);
    expect(page.operations.length).toBeLessThan(50);
    expect(page.nextCursor).toBe(page.operations.at(-1).operationId);
  }
});

it.each(["accepted", "failed"])("cannot replace an existing final %s outcome", async (state) => {
  seed(1, { state });
  await plugin(host.bb);
  const before = await operations();
  const result = await cli([
    "resolve-operation",
    "op-000",
    "--outcome",
    "failed",
    "--project",
    "proj_a",
    "--verified",
  ]);
  expect(result.stderr).toBe("OPERATION_ALREADY_FINAL");
  expect(await operations()).toEqual(before);
});

it("only one concurrent local resolution can finalize an unresolved record", async () => {
  seed();
  await plugin(host.bb);
  const results = await Promise.all([
    cli([
      "resolve-operation",
      "op-000",
      "--outcome",
      "failed",
      "--project",
      "proj_a",
      "--verified",
    ]),
    cli([
      "resolve-operation",
      "op-000",
      "--outcome",
      "accepted",
      "--project",
      "proj_a",
      "--thread",
      "thr_other",
      "--verified",
    ]),
  ]);
  expect(results.map((r) => r.exitCode)).toEqual([0, 1]);
  expect(results[1].stderr).toBe("OPERATION_ALREADY_FINAL");
  expect((await operations()).operations[0]).toMatchObject({ state: "failed", threadId: null });
  expect(host.harness.inspection.sdk.calls).toEqual([]);
});
