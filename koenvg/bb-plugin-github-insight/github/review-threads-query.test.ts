import { describe, expect, it } from "vitest";
import { reviewThreadsPageArgs } from "./review-threads-query";

const pr = { owner: "collibra", repo: "frontend", number: 25259 };

describe("reviewThreadsPageArgs", () => {
  it("passes the cursor only after the first page", () => {
    expect(
      reviewThreadsPageArgs({ ...pr, after: null }).some((arg) => arg.startsWith("after=")),
    ).toBe(false);
    expect(reviewThreadsPageArgs({ ...pr, after: "Y3Vy" })).toEqual(
      expect.arrayContaining(["-f", "after=Y3Vy"]),
    );
  });
});
