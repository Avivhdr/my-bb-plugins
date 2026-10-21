import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { createSeenComments } from "./seen-comments";

const PR = { owner: "Acme", repo: "API", number: 15 };
const KEY = "comment-seen:v1:acme/api#15";

function fakeKv(rows: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(rows));
  const kv: PluginKvStorage = {
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
    list: async (prefix = "") => [...data.keys()].filter((key) => key.startsWith(prefix)),
  };
  return { kv, data };
}

describe("seen comments", () => {
  it("reads no ids for a PR without an entry", async () => {
    expect(await createSeenComments(fakeKv().kv).get(PR)).toEqual(new Set());
  });

  it("reads no ids from invalid stored data", async () => {
    const { kv } = fakeKv({ [KEY]: { v: 2, ids: "x" } });

    expect(await createSeenComments(kv).get(PR)).toEqual(new Set());
  });

  it("adds ids to the stored ids under a lowercase key", async () => {
    const { kv, data } = fakeKv({ [KEY]: { v: 1, ids: ["c1"] } });
    const store = createSeenComments(kv);

    await store.add(PR, ["c2", "c1"]);

    expect(data.get(KEY)).toEqual({ v: 1, ids: ["c1", "c2"] });
  });

  it("lands two adds in a row", async () => {
    const { kv } = fakeKv();
    const store = createSeenComments(kv);

    await Promise.all([store.add(PR, ["c1"]), store.add(PR, ["c2"])]);

    expect(await store.get(PR)).toEqual(new Set(["c1", "c2"]));
  });

  it("deletes the ids of the PR", async () => {
    const { kv, data } = fakeKv({ [KEY]: { v: 1, ids: ["c1"] } });

    await createSeenComments(kv).delete(PR);

    expect(data.has(KEY)).toBe(false);
  });
});
