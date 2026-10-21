import { describe, expect, it } from "vitest";
import { projectBadge, readableOn } from "./project-badge";

describe("project badge", () => {
  it("gives each project a stable colour, a readable letter colour and its first letter", () => {
    const badge = projectBadge("p1", " frontend");
    expect(badge.background).toBe(projectBadge("p1", "renamed").background);
    expect(badge.background).toMatch(/^#[0-9A-F]{6}$/);
    expect(["#000000", "#FFFFFF"]).toContain(badge.foreground);
    expect(badge.letter).toBe("F");
    expect(projectBadge("p1", "  ").letter).toBe("?");
  });
  it("picks the letter colour with the higher contrast", () => {
    expect(readableOn("#CA8A04")).toBe("#000000");
    expect(readableOn("#4F46E5")).toBe("#FFFFFF");
  });
});
