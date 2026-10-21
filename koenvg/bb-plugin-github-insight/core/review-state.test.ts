import { describe, expect, it } from "vitest";
import { reviewState } from "./review-state";

describe("reviewState", () => {
  it("needs review without a mark", () => {
    expect(reviewState(null, "abc123")).toBe("needs_review");
  });

  it("is reviewed when the mark is the current head", () => {
    expect(reviewState("abc123", "abc123")).toBe("reviewed");
  });

  it.each([
    ["a push", "def456"],
    ["a force push", "fff000"],
  ])("is updated since review after %s", (_, head) => {
    expect(reviewState("abc123", head)).toBe("updated_since_review");
  });
});
