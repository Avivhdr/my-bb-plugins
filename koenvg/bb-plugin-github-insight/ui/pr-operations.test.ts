import { describe, expect, it, vi } from "vitest";
import { createPrOperations } from "./pr-operations";
import type { ActionResult } from "../contract";

const request = { action: "merge" as const, expectedHeadOid: "head-a" };
function deferred() {
  let resolve!: (result: ActionResult) => void;
  const promise = new Promise<ActionResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("shared merge operations", () => {
  it("shares progress and guards concurrent callers before the RPC resolves", async () => {
    const operations = createPrOperations();
    const pending = deferred();
    const send = vi.fn(() => pending.promise);
    const first = vi.fn();
    const second = vi.fn();
    const offA = operations.subscribe("a", first);
    const offB = operations.subscribe("a", second);
    const run = operations.run("a", request, send);
    await operations.run("a", request, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(operations.snapshot("a")).toEqual({ kind: "running", ...request });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    pending.resolve({ kind: "ok" });
    await run;
    expect(operations.snapshot("a")).toEqual({ kind: "idle" });
    offA();
    offB();
  });

  it("sends one write per thread across action kinds", async () => {
    const operations = createPrOperations();
    const pending = deferred();
    const send = vi.fn(() => pending.promise);
    const run = operations.run("a", { action: "update-merge", expectedHeadOid: "head-a" }, send);

    await operations.run("a", request, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(operations.snapshot("a")).toMatchObject({ kind: "running", action: "update-merge" });
    pending.resolve({ kind: "ok" });
    await run;
  });

  it("keeps active work after unsubscribe and isolates threads", async () => {
    const operations = createPrOperations();
    const pending = deferred();
    const send = vi.fn(() => pending.promise);
    const off = operations.subscribe("a", () => {});
    const run = operations.run("a", request, send);
    off();
    const offAgain = operations.subscribe("a", () => {});
    await operations.run("a", request, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(operations.snapshot("b")).toEqual({ kind: "idle" });
    const sendB = vi.fn(async () => ({ kind: "ok" as const }));
    await operations.run("b", request, sendB);
    expect(sendB).toHaveBeenCalledTimes(1);
    pending.resolve({ kind: "error", message: "rejected" });
    await run;
    expect(operations.snapshot("a")).toEqual({
      kind: "error",
      message: "rejected",
      action: "merge",
      headOid: "head-a",
    });
    offAgain();
    expect(operations.snapshot("a")).toEqual({ kind: "idle" });
  });

  it("releases the guard after an RPC rejects and supports dismissing errors", async () => {
    const operations = createPrOperations();
    const off = operations.subscribe("a", () => {});
    await operations.run("a", request, async () => {
      throw new Error("offline");
    });
    expect(operations.snapshot("a")).toEqual({
      kind: "error",
      message: "offline",
      action: "merge",
      headOid: "head-a",
    });
    operations.dismiss("a");
    expect(operations.snapshot("a")).toEqual({ kind: "idle" });
    const send = vi.fn(async () => ({ kind: "ok" as const }));
    await operations.run("a", request, send);
    expect(send).toHaveBeenCalledTimes(1);
    off();
  });

  it("keeps a fast enqueue error until its first subscriber leaves", async () => {
    const operations = createPrOperations();
    const enqueue = { action: "enqueue" as const, expectedHeadOid: "head-a" };
    await operations.run("a", enqueue, async () => ({ kind: "error", message: "rejected" }));

    const off = operations.subscribe("a", () => {});
    expect(operations.snapshot("a")).toEqual({
      kind: "error",
      message: "rejected",
      action: "enqueue",
      headOid: "head-a",
    });
    off();
    expect(operations.snapshot("a")).toEqual({ kind: "idle" });
  });

  it("discards an error that arrives after the last subscriber leaves", async () => {
    const operations = createPrOperations();
    const pending = deferred();
    const off = operations.subscribe("a", () => {});
    const run = operations.run("a", request, () => pending.promise);
    off();
    expect(operations.snapshot("a")).toEqual({ kind: "running", ...request });

    pending.resolve({ kind: "error", message: "rejected" });
    await run;
    const offAgain = operations.subscribe("a", () => {});
    expect(operations.snapshot("a")).toEqual({ kind: "idle" });
    offAgain();
  });
});
