import assert from "node:assert/strict";

// Keep the former runner's complete-PNG and backing-pixel checks.
export function validateScreenshot(png: Buffer, width: number, height: number, scale: number) {
  assert(
    png.length >= 33 &&
      png.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      png.subarray(-12).equals(Buffer.from("0000000049454e44ae426082", "hex")),
    "screenshot returned no complete PNG",
  );
  const pixels = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.deepEqual(
    pixels,
    [Math.round(width * scale), Math.round(height * scale)],
    "screenshot dimensions do not match the viewport and pixel scale",
  );
  return pixels;
}
