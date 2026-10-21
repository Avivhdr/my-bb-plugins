import { describe, expect, it } from "vitest";
import { createReviewedMarks } from "./reviewed-marks";

function fakeKv(entries = new Map<string, unknown>()) {
  return {
    entries,
    get: async <T>(key: string) => entries.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      entries.set(key, structuredClone(value));
    },
    delete: async (key: string) => {
      entries.delete(key);
    },
    list: async (prefix: string) => [...entries.keys()].filter((key) => key.startsWith(prefix)),
  };
}

describe("reviewed marks", () => {
  it("lists a saved mark with its head commit", async () => {
    const marks = createReviewedMarks(fakeKv(), () => 7);

    await marks.save({ owner: "acme", repo: "api", number: 15 }, "abc123");

    expect(await marks.list()).toEqual([
      { ref: { owner: "acme", repo: "api", number: 15 }, headOid: "abc123", markedAt: 7 },
    ]);
  });

  it("keys a mark without regard to the case of the repository", async () => {
    const kv = fakeKv();
    const marks = createReviewedMarks(kv, () => 1);

    await marks.save({ owner: "Acme", repo: "API", number: 15 }, "abc123");
    await marks.save({ owner: "acme", repo: "api", number: 15 }, "def456");

    expect([...kv.entries.keys()]).toEqual(["reviewed:acme/api#15"]);
    expect(await marks.list()).toEqual([
      { ref: { owner: "acme", repo: "api", number: 15 }, headOid: "def456", markedAt: 1 },
    ]);
  });

  it("deletes a mark", async () => {
    const marks = createReviewedMarks(fakeKv(), () => 1);
    await marks.save({ owner: "acme", repo: "api", number: 15 }, "abc123");

    await marks.delete({ owner: "ACME", repo: "api", number: 15 });

    expect(await marks.list()).toEqual([]);
  });

  it("ignores an invalid stored mark and keys of other features", async () => {
    const kv = fakeKv(
      new Map<string, unknown>([
        [
          "reviewed:acme/api#15",
          { v: 2, owner: "acme", repo: "api", number: 15, headOid: "abc123", markedAt: 1 },
        ],
        ["summary:acme/api#15", { body: "x" }],
      ]),
    );

    expect(await createReviewedMarks(kv, () => 1).list()).toEqual([]);
  });

  it("reads the mark of one PR without regard to case", async () => {
    const marks = createReviewedMarks(fakeKv(), () => 7);
    await marks.save({ owner: "acme", repo: "api", number: 15 }, "abc123");

    expect(await marks.get({ owner: "Acme", repo: "API", number: 15 })).toEqual({
      ref: { owner: "acme", repo: "api", number: 15 },
      headOid: "abc123",
      markedAt: 7,
    });
    expect(await marks.get({ owner: "acme", repo: "api", number: 16 })).toBeNull();
  });
});
