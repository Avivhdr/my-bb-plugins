import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture } from "./fixtures.js";
import { operationMigration } from "../operations.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});

it("upgrades the BBP-81 ledger without replaying accepted or unresolved starts", async () => {
  const input = { projectId: "proj_a", prompt: "Legacy fixture", operationKey: "legacy" };
  f = await fixture({}, {}, (host) => {
    const db = host.bb.storage.database();
    host.bb.storage.migrate(db, [operationMigration]);
    const hash = createHash("sha256")
      .update(JSON.stringify(["proj_a", "Legacy fixture", null]))
      .digest("hex");
    for (const state of ["accepted", "unknown"]) {
      db.prepare("INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        "legacy-" + state,
        "https://issuer.example.org/realm",
        "owner-1",
        "bb_start_thread",
        state === "accepted" ? "legacy" : "unresolved",
        hash,
        "proj_a",
        state === "accepted" ? "thr_legacy" : null,
        state,
        null,
        Date.now(),
        Date.now(),
        "old-generation",
      );
    }
  });
  f.change({ controlEnabled: true });
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_legacy", projectId: "proj_a" }),
  );
  const credential = await f.token({ scope: "bb.read bb.control" });
  for (const state of ["accepted", "unknown"]) {
    const result = await (
      await f.rpc(
        "tools/call",
        {
          name: "bb_start_thread",
          arguments: { ...input, operationKey: state === "accepted" ? "legacy" : "unresolved" },
        },
        credential,
      )
    ).json();
    expect(result.result.structuredContent).toMatchObject({
      state,
      operationId: "legacy-" + state,
    });
    expect(result.result.structuredContent).not.toHaveProperty("delivery");
    for (const workspace of ["project-folder", "worktree"]) {
      const conflict = await (
        await f.rpc(
          "tools/call",
          {
            name: "bb_start_thread",
            arguments: {
              ...input,
              operationKey: state === "accepted" ? "legacy" : "unresolved",
              workspace,
            },
          },
          credential,
        )
      ).json();
      expect(conflict.result.content).toEqual([{ type: "text", text: "OPERATION_CONFLICT" }]);
    }
  }
  expect(f.host.harness.inspection.sdk.callsTo("threads.spawn")).toHaveLength(0);
  expect(f.host.harness.inspection.sdk.calls.map((c) => c.path)).toEqual(["threads.get"]);
});
