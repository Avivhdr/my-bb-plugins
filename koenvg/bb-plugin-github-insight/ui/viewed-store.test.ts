import { describe, expect, it } from "vitest";
import type { ActionResult } from "../contract";
import { createViewedStore, effectiveMarks } from "./viewed-store";

const THREAD = "thr_1";

function deferred() {
  let resolve!: (result: ActionResult) => void;
  const promise = new Promise<ActionResult>((done) => (resolve = done));
  return { promise, resolve };
}

const ok = async (): Promise<ActionResult> => ({ kind: "ok" });

function marksOf(store: ReturnType<typeof createViewedStore>, base: Record<string, string>) {
  return effectiveMarks(store.get(THREAD), base);
}

describe("createViewedStore", () => {
  it("shows a mark while its save runs and keeps it after the save", async () => {
    const store = createViewedStore();
    const save = deferred();

    const written = store.setViewed(THREAD, "a.ts", "1:aa", () => save.promise);
    expect(marksOf(store, {})).toEqual({ "a.ts": "1:aa" });
    save.resolve({ kind: "ok" });
    await written;

    expect(marksOf(store, {})).toEqual({ "a.ts": "1:aa" });
    expect(store.get(THREAD).error).toBeNull();
  });

  it("reverts a failed save and reports the error", async () => {
    const store = createViewedStore();

    await store.setViewed(THREAD, "a.ts", "1:aa", async () => ({
      kind: "error",
      message: "disk full",
    }));

    expect(marksOf(store, {})).toEqual({});
    expect(store.get(THREAD).error).toBe("Could not save viewed state: disk full");
  });

  it("reverts a save that throws", async () => {
    const store = createViewedStore();

    await store.setViewed(THREAD, "a.ts", null, async () => {
      throw new Error("offline");
    });

    expect(marksOf(store, { "a.ts": "1:aa" })).toEqual({ "a.ts": "1:aa" });
    expect(store.get(THREAD).error).toBe("Could not save viewed state: offline");
  });

  it("keeps a newer write when an older one fails", async () => {
    const store = createViewedStore();
    const first = deferred();

    const firstWrite = store.setViewed(THREAD, "a.ts", "1:aa", () => first.promise);
    await store.setViewed(THREAD, "a.ts", null, ok);
    first.resolve({ kind: "error", message: "disk full" });
    await firstWrite;

    expect(marksOf(store, { "a.ts": "1:aa" })).toEqual({});
    expect(store.get(THREAD).error).toBe("Could not save viewed state: disk full");
  });

  it("keeps a write in flight when a new review result arrives", () => {
    const store = createViewedStore();
    void store.setViewed(THREAD, "a.ts", "1:aa", () => deferred().promise);

    store.loaded(THREAD, {});

    expect(marksOf(store, {})).toEqual({ "a.ts": "1:aa" });
  });

  it("keeps a saved mark over one review result that was read before the save", async () => {
    const store = createViewedStore();
    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    store.loaded(THREAD, {});

    expect(marksOf(store, {})).toEqual({ "a.ts": "1:aa" });
  });

  it("uses the stored marks after two review results disagree with a save", async () => {
    const store = createViewedStore();
    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    store.loaded(THREAD, {});
    const second = { "b.ts": "1:bb" };
    store.loaded(THREAD, second);

    expect(marksOf(store, second)).toEqual({ "b.ts": "1:bb" });
  });

  it("uses the stored marks once a review result agrees with a save", async () => {
    const store = createViewedStore();
    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    store.loaded(THREAD, { "a.ts": "1:aa" });

    expect(store.get(THREAD).overrides.size).toBe(0);
  });

  it("goes back to the saved state when a later save fails", async () => {
    const store = createViewedStore();
    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    await store.setViewed(THREAD, "a.ts", null, async () => ({
      kind: "error",
      message: "disk full",
    }));

    expect(marksOf(store, {})).toEqual({ "a.ts": "1:aa" });
  });

  it("settles an older write that succeeds under a newer write that fails", async () => {
    const store = createViewedStore();
    const first = deferred();
    const second = deferred();

    const firstWrite = store.setViewed(THREAD, "a.ts", "1:aa", () => first.promise);
    const secondWrite = store.setViewed(THREAD, "a.ts", null, () => second.promise);
    first.resolve({ kind: "ok" });
    await firstWrite;
    second.resolve({ kind: "error", message: "disk full" });
    await secondWrite;
    store.loaded(THREAD, { "a.ts": "1:aa" });

    expect(marksOf(store, { "a.ts": "1:aa" })).toEqual({ "a.ts": "1:aa" });
    expect(store.get(THREAD).overrides.size).toBe(0);
  });

  it("does not drop saved writes when the same result is seen again", async () => {
    const store = createViewedStore();
    const result = {};
    store.loaded(THREAD, result);
    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    store.loaded(THREAD, result);

    expect(marksOf(store, result)).toEqual({ "a.ts": "1:aa" });
  });

  it("clears the collapse toggle when the mark changes", async () => {
    const store = createViewedStore();
    store.setCollapsed(THREAD, "a.ts", false);

    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    expect(store.get(THREAD).collapsed.has("a.ts")).toBe(false);
  });

  it("removes stale marks and their collapse toggles, and keeps them removed when the save fails", async () => {
    const store = createViewedStore();
    store.setCollapsed(THREAD, "a.ts", false);

    await store.prune(THREAD, ["a.ts"], async () => ({ kind: "error", message: "disk full" }));

    expect(marksOf(store, { "a.ts": "1:aa", "b.ts": "1:bb" })).toEqual({ "b.ts": "1:bb" });
    expect(store.get(THREAD).collapsed.has("a.ts")).toBe(false);
    expect(store.get(THREAD).error).toBe("Could not save viewed state: disk full");
  });

  it("keeps a save error when stale marks are removed", async () => {
    const store = createViewedStore();
    await store.setViewed(THREAD, "a.ts", "1:aa", async () => ({
      kind: "error",
      message: "disk full",
    }));

    await store.prune(THREAD, ["b.ts"], ok);

    expect(store.get(THREAD).error).toBe("Could not save viewed state: disk full");
  });

  it("keeps threads apart", async () => {
    const store = createViewedStore();

    await store.setViewed(THREAD, "a.ts", "1:aa", ok);

    expect(effectiveMarks(store.get("thr_2"), {})).toEqual({});
  });

  it("tells subscribers about changes", () => {
    const store = createViewedStore();
    let calls = 0;
    const unsubscribe = store.subscribe(() => calls++);

    store.setCollapsed(THREAD, "a.ts", true);
    unsubscribe();
    store.setCollapsed(THREAD, "a.ts", false);

    expect(calls).toBe(1);
  });
});
