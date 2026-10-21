import { describe, expect, it } from "vitest";
import { createViewedStore, viewedKey } from "./viewed-store";

const ALL_A = viewedKey("thr_a", { kind: "all" });
const ALL_B = viewedKey("thr_b", { kind: "all" });

const saved = async () => ({ kind: "ok" as const });
const failed = async () => ({ kind: "error" as const, message: "disk full" });

describe("viewed store", () => {
  it("keeps the marks of two threads apart", async () => {
    const store = createViewedStore();
    store.loaded(ALL_A, {});
    store.loaded(ALL_B, {});

    await store.setViewed(ALL_A, "src/a.ts", "5:aaaa", saved);

    expect(store.get(ALL_A).marks).toEqual({ "src/a.ts": "5:aaaa" });
    expect(store.get(ALL_B).marks).toEqual({});
  });

  it("shows a mark before the save ends", () => {
    const store = createViewedStore();
    store.loaded(ALL_A, {});

    void store.setViewed(ALL_A, "src/a.ts", "5:aaaa", () => new Promise(() => {}));

    expect(store.get(ALL_A).marks).toEqual({ "src/a.ts": "5:aaaa" });
  });

  it("puts back the previous mark and sets the error when the save fails", async () => {
    const store = createViewedStore();
    store.loaded(ALL_A, { "src/a.ts": "5:aaaa" });

    await store.setViewed(ALL_A, "src/a.ts", null, failed);

    expect(store.get(ALL_A)).toMatchObject({
      marks: { "src/a.ts": "5:aaaa" },
      error: "Could not save viewed state: disk full",
    });
  });

  it("keeps marks that are already loaded when a late load arrives", async () => {
    const store = createViewedStore();
    store.loaded(ALL_A, {});
    await store.setViewed(ALL_A, "src/a.ts", "5:aaaa", saved);

    store.loaded(ALL_A, {});

    expect(store.get(ALL_A).marks).toEqual({ "src/a.ts": "5:aaaa" });
  });

  it("does not put back a mark that a later click changed", async () => {
    const store = createViewedStore();
    store.loaded(ALL_A, {});
    let failFirst: () => void = () => {};
    const first = store.setViewed(
      ALL_A,
      "src/a.ts",
      "5:aaaa",
      () =>
        new Promise(
          (resolve) => (failFirst = () => resolve({ kind: "error", message: "disk full" })),
        ),
    );
    await store.setViewed(ALL_A, "src/a.ts", null, saved);
    await store.setViewed(ALL_A, "src/a.ts", "5:aaaa", saved);

    failFirst();
    await first;

    expect(store.get(ALL_A).marks).toEqual({ "src/a.ts": "5:aaaa" });
  });

  it("clears the collapse toggle of a file when its mark changes", async () => {
    const store = createViewedStore();
    store.loaded(ALL_A, { "src/a.ts": "5:aaaa" });
    store.setCollapsed(ALL_A, "src/a.ts", false);
    store.setCollapsed(ALL_A, "src/b.ts", true);

    await store.setViewed(ALL_A, "src/a.ts", null, saved);

    expect(store.get(ALL_A).collapsed).toEqual(new Map([["src/b.ts", true]]));
  });

  it("prunes marks and their collapse toggles, and keeps them pruned when the save fails", async () => {
    const store = createViewedStore();
    store.loaded(ALL_A, { "src/a.ts": "5:aaaa", "src/b.ts": "5:bbbb" });
    store.setCollapsed(ALL_A, "src/a.ts", false);

    await store.prune(ALL_A, ["src/a.ts"], failed);

    expect(store.get(ALL_A)).toEqual({
      marks: { "src/b.ts": "5:bbbb" },
      collapsed: new Map(),
      error: "Could not save viewed state: disk full",
    });
  });

  it("names a commit target by its sha", () => {
    expect(viewedKey("thr_a", { kind: "commit", sha: "abc1234def" })).not.toBe(
      viewedKey("thr_a", { kind: "commit", sha: "fff0000aaa" }),
    );
  });
});
