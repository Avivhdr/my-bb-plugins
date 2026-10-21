import type { PluginKvStorage } from "@get-bb/plugin-sdk";
import { describe, expect, it } from "vitest";
import { createViewedMarksStore } from "./viewed-marks-store";

const PR = { owner: "collibra", repo: "frontend", number: 42 };
const KEY = "viewed:v1:collibra/frontend#42";

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

describe("createViewedMarksStore", () => {
  it("reads no marks for a PR without an entry", async () => {
    const store = createViewedMarksStore(fakeKv().kv);

    expect(await store.get(PR)).toEqual({});
  });

  it("reads no marks from invalid stored data", async () => {
    const store = createViewedMarksStore(fakeKv({ [KEY]: { v: 2, marks: "x" } }).kv);

    expect(await store.get(PR)).toEqual({});
  });

  it("reads the marks of the PR only", async () => {
    const { kv } = fakeKv({
      [KEY]: { v: 1, marks: { "a.ts": "1:aa" } },
      "viewed:v1:collibra/frontend#43": { v: 1, marks: { "b.ts": "1:bb" } },
    });

    expect(await createViewedMarksStore(kv).get(PR)).toEqual({ "a.ts": "1:aa" });
  });

  it("lands two updates in a row", async () => {
    const { kv, data } = fakeKv();
    const store = createViewedMarksStore(kv);

    const results = await Promise.all([
      store.update(PR, { "a.ts": "1:aa" }, []),
      store.update(PR, { "b.ts": "1:bb" }, []),
    ]);

    expect(results).toEqual([{ kind: "ok" }, { kind: "ok" }]);
    expect(data.get(KEY)).toEqual({ v: 1, marks: { "a.ts": "1:aa", "b.ts": "1:bb" } });
  });

  it("deletes the entry when the last mark is removed", async () => {
    const { kv, data } = fakeKv({ [KEY]: { v: 1, marks: { "a.ts": "1:aa" } } });

    await createViewedMarksStore(kv).update(PR, {}, ["a.ts"]);

    expect(data.has(KEY)).toBe(false);
  });

  it("reports a storage error", async () => {
    const { kv } = fakeKv();
    kv.set = async () => {
      throw new Error("disk full");
    };

    const result = await createViewedMarksStore(kv).update(PR, { "a.ts": "1:aa" }, []);

    expect(result).toEqual({ kind: "error", message: "disk full" });
  });

  it("runs the next update after a failed one", async () => {
    const { kv, data } = fakeKv();
    const set = kv.set;
    let fail = true;
    kv.set = async (key, value) => {
      if (fail) {
        fail = false;
        throw new Error("disk full");
      }
      await set(key, value);
    };
    const store = createViewedMarksStore(kv);

    const results = await Promise.all([
      store.update(PR, { "a.ts": "1:aa" }, []),
      store.update(PR, { "b.ts": "1:bb" }, []),
    ]);

    expect(results[1]).toEqual({ kind: "ok" });
    expect(data.get(KEY)).toEqual({ v: 1, marks: { "b.ts": "1:bb" } });
  });
});
