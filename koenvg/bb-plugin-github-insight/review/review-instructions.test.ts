import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEW_INSTRUCTIONS } from "../core/review-prompt";
import { createReviewInstructionsStore } from "./review-instructions";

function fakeKv() {
  const entries = new Map<string, unknown>();
  return {
    entries,
    get: async <T>(key: string) => entries.get(key) as T | undefined,
    set: async (key: string, value: unknown) => {
      entries.set(key, value);
    },
    delete: async (key: string) => {
      entries.delete(key);
    },
  };
}

describe("review instructions store", () => {
  it("gives the defaults when nothing is saved", async () => {
    const store = createReviewInstructionsStore(fakeKv());

    expect(await store.get()).toEqual({
      instructions: DEFAULT_REVIEW_INSTRUCTIONS,
      isDefault: true,
    });
  });

  it("saves trimmed instructions and reads them back", async () => {
    const kv = fakeKv();
    const store = createReviewInstructionsStore(kv);

    expect(await store.set("  Mine\n")).toEqual({ kind: "ok" });

    expect(await store.get()).toEqual({ instructions: "Mine", isDefault: false });
    expect(kv.entries.get("review-instructions")).toEqual({ v: 1, instructions: "Mine" });
  });

  it("goes back to the defaults on null", async () => {
    const store = createReviewInstructionsStore(fakeKv());
    await store.set("Mine");

    await store.set(null);

    expect(await store.get()).toMatchObject({ isDefault: true });
  });

  it("reads an entry of another version as the defaults", async () => {
    const kv = fakeKv();
    kv.entries.set("review-instructions", { v: 9, instructions: "x" });

    expect(await createReviewInstructionsStore(kv).get()).toMatchObject({ isDefault: true });
  });
});
