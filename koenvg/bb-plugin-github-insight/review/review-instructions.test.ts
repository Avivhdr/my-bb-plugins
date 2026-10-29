import { describe, expect, it } from "vitest";
import { DEFAULT_RE_REVIEW_INSTRUCTIONS, DEFAULT_REVIEW_INSTRUCTIONS } from "../core/review-prompt";
import { createReviewInstructionsStore, RE_REVIEW_INSTRUCTIONS } from "./review-instructions";

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
    expect(kv.entries.get("review-instructions")).toEqual({ v: 2, instructions: "Mine" });
  });

  it("goes back to the defaults on null", async () => {
    const store = createReviewInstructionsStore(fakeKv());
    await store.set("Mine");

    await store.set(null);

    expect(await store.get()).toMatchObject({ isDefault: true });
  });

  it("keeps the re-review instructions under their own key and defaults", async () => {
    const kv = fakeKv();
    const review = createReviewInstructionsStore(kv);
    const reReview = createReviewInstructionsStore(kv, RE_REVIEW_INSTRUCTIONS);

    expect(await reReview.get()).toEqual({
      instructions: DEFAULT_RE_REVIEW_INSTRUCTIONS,
      isDefault: true,
    });
    await reReview.set("Only tests");

    expect(kv.entries.get("re-review-instructions")).toEqual({ v: 2, instructions: "Only tests" });
    expect(await review.get()).toMatchObject({ isDefault: true });
  });

  it("reads How to review text saved by v1 with the default Summary rules and Rules", async () => {
    const kv = fakeKv();
    kv.entries.set("re-review-instructions", { v: 1, instructions: "Only tests" });

    const { instructions, isDefault } = await createReviewInstructionsStore(
      kv,
      RE_REVIEW_INSTRUCTIONS,
    ).get();

    expect(isDefault).toBe(false);
    expect(instructions.startsWith("## How to review\n\nOnly tests\n\n## Summary rules")).toBe(
      true,
    );
    expect(instructions).toContain("- List only what still needs work:");
  });

  it("reads an entry of another version as the defaults", async () => {
    const kv = fakeKv();
    kv.entries.set("review-instructions", { v: 9, instructions: "x" });

    expect(await createReviewInstructionsStore(kv).get()).toMatchObject({ isDefault: true });
  });
});
