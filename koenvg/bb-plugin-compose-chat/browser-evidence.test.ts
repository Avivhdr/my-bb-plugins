import { describe, expect, it } from "vitest";
import { validateScreenshot } from "./tests/browser-evidence.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lXcAAAAASUVORK5CYII=",
  "base64",
);

describe("browser screenshot evidence", () => {
  it("accepts complete PNGs at the requested backing scale", () => {
    expect(validateScreenshot(png, 1, 1, 1)).toEqual([1, 1]);
    expect(validateScreenshot(png, 0.5, 0.5, 2)).toEqual([1, 1]);
  });

  it("rejects missing, invalid and truncated PNGs", () => {
    for (const invalid of [
      Buffer.alloc(0),
      Buffer.from("not a png"),
      png.subarray(0, -1),
      Buffer.concat([Buffer.alloc(8), png.subarray(8)]),
    ]) {
      expect(() => validateScreenshot(invalid, 1, 1, 1)).toThrow("no complete PNG");
    }
  });

  it("rejects captures with the wrong dimensions or pixel scale", () => {
    expect(() => validateScreenshot(png, 2, 1, 1)).toThrow("screenshot dimensions");
    expect(() => validateScreenshot(png, 1, 1, 2)).toThrow("screenshot dimensions");
  });
});
