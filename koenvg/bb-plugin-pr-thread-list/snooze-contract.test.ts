import { describe, expect, it } from "vitest";
import { rpcContract } from "./contract";

describe("snooze snapshot contract", () => {
  const schema = rpcContract.listSnoozes.output;
  it("requires membership alongside deadlines", () => {
    expect(schema.safeParse({ snoozes: { parent: 10 } }).success).toBe(false);
    expect(schema.safeParse({ snoozes: { parent: 10 }, groups: {} }).success).toBe(false);
    expect(schema.safeParse({ snoozes: {}, groups: { parent: "group" } }).success).toBe(false);
    expect(schema.safeParse({ snoozes: { parent: 10 }, groups: { parent: "group" } }).success).toBe(
      true,
    );
  });
  it("rejects a group with inconsistent deadlines", () => {
    expect(
      schema.safeParse({ snoozes: { parent: 10, child: 20 }, groups: { parent: "g", child: "g" } })
        .success,
    ).toBe(false);
  });
  it("keeps the existing mutation inputs", () => {
    expect(rpcContract.snooze.input.parse({ threadId: "parent", wakeAt: 10 })).toEqual({
      threadId: "parent",
      wakeAt: 10,
    });
    expect(rpcContract.wake.input.parse({ threadId: "child" })).toEqual({ threadId: "child" });
  });
});
