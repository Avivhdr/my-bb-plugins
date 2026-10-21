import { describe, expect, it } from "vitest";
import { timelinePageArgs } from "./timeline-query";

const pr = { owner: "cli", repo: "cli", number: 9000 };

describe("timelinePageArgs", () => {
  it("passes the cursor only for older pages", () => {
    expect(timelinePageArgs({ ...pr, before: null }).some((arg) => arg.startsWith("before="))).toBe(
      false,
    );
    expect(timelinePageArgs({ ...pr, before: "Y3Vy" })).toEqual(
      expect.arrayContaining(["-f", "before=Y3Vy"]),
    );
  });

  it("sends the number as a typed field", () => {
    expect(timelinePageArgs({ ...pr, before: null })).toEqual(
      expect.arrayContaining(["-F", "number=9000"]),
    );
  });
});
