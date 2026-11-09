import { describe, expect, it } from "vitest";
import { isWorkingDay, localDay, msUntilMidnight } from "./working-day";

const MORNING = new Date(2026, 10, 9, 8, 30).getTime();

describe("working day", () => {
  it("names the local day", () => {
    expect(localDay(MORNING)).toBe("2026-11-09");
    expect(localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
  });

  it("is on only for the day it was switched on", () => {
    expect(isWorkingDay("2026-11-09", MORNING)).toBe(true);
    expect(isWorkingDay("2026-11-09", new Date(2026, 10, 9, 23, 59).getTime())).toBe(true);
    expect(isWorkingDay("2026-11-09", new Date(2026, 10, 10, 0, 0).getTime())).toBe(false);
    expect(isWorkingDay(null, MORNING)).toBe(false);
  });

  it("counts down to the next local midnight", () => {
    expect(msUntilMidnight(MORNING)).toBe((15 * 60 + 30) * 60_000);
  });
});
