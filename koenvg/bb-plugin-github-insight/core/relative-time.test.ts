import { describe, expect, it } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2026-10-01T16:00:00Z");

function ago(seconds: number): string {
  return relativeTime(new Date(NOW.getTime() - seconds * 1000), NOW, "en");
}

describe("relativeTime", () => {
  it("says now for the last minute", () => {
    expect(ago(20)).toBe("now");
  });

  it("uses the largest whole unit", () => {
    expect(ago(5 * 60)).toBe("5 minutes ago");
    expect(ago(2 * 3_600)).toBe("2 hours ago");
    expect(ago(86_400)).toBe("yesterday");
    expect(ago(3 * 604_800)).toBe("3 weeks ago");
    expect(ago(400 * 86_400)).toBe("last year");
  });
});
