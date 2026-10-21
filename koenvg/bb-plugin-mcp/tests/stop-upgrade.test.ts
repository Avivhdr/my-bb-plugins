import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { makeThreadResponse } from "@get-bb/plugin-sdk/testing";
import { fixture } from "./fixtures.js";
import { operationMigration, operationSubmissionMigration } from "../operations.js";

let f: Awaited<ReturnType<typeof fixture>>;
afterEach(async () => {
  await f?.close();
});

it("upgrades the BBP-82 ledger without changing accepted or unresolved send results", async () => {
  f = await fixture({}, {}, (host) => {
    const db = host.bb.storage.database();
    host.bb.storage.migrate(db, [operationMigration, operationSubmissionMigration]);
    const hash = createHash("sha256")
      .update(JSON.stringify(["thr_legacy", "Legacy instruction"]))
      .digest("hex");
    for (const state of ["accepted", "pending", "unknown"]) {
      db.prepare("INSERT INTO operations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
        "legacy-" + state,
        "https://issuer.example.org/realm",
        "owner-1",
        "bb_send_message",
        state,
        hash,
        "proj_a",
        "thr_legacy",
        state,
        null,
        Date.now(),
        Date.now(),
        "old-generation",
        state === "accepted" ? "queued" : null,
        state === "accepted" ? "interaction" : null,
      );
    }
  });
  f.change({ controlEnabled: true });
  f.host.harness.sdk.stub("threads.get", async () =>
    makeThreadResponse({ id: "thr_legacy", projectId: "proj_a" }),
  );
  const credential = await f.token({ scope: "bb.read bb.control" });
  for (const state of ["accepted", "pending", "unknown"]) {
    const reply = (
      await (
        await f.rpc(
          "tools/call",
          {
            name: "bb_send_message",
            arguments: {
              threadId: "thr_legacy",
              message: "Legacy instruction",
              operationKey: state,
            },
          },
          credential,
        )
      ).json()
    ).result.structuredContent;
    expect(reply).toMatchObject({
      operationId: "legacy-" + state,
      state: state === "pending" ? "unknown" : state,
      delivery: state === "accepted" ? "queued" : null,
      waitingOn: state === "accepted" ? "interaction" : null,
    });
    expect(reply).not.toHaveProperty("stopRequested");
    const status = (
      await (
        await f.rpc("tools/call", {
          name: "bb_get_operation",
          arguments: { operationId: reply.operationId },
        })
      ).json()
    ).result.structuredContent;
    expect(status).toEqual(reply);
  }
  expect(f.host.harness.inspection.sdk.callsTo("threads.send")).toHaveLength(0);
  expect(f.host.harness.inspection.sdk.callsTo("threads.stop")).toHaveLength(0);
});
