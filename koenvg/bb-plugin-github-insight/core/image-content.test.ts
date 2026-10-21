import { describe, expect, it } from "vitest";
import { imageBytes, imageWire, MAX_IMAGE_BYTES } from "./image-content";

const png = Buffer.from("89504e470d0a1a0a00000000", "hex");
describe("raster transport policy", () => {
  it("uses bytes rather than declared MIME", () => {
    expect(
      imageWire({ content: png.toString("base64"), contentEncoding: "base64", sizeBytes: 12 }),
    ).toEqual({ kind: "ready", content: "iVBORw0KGgoAAAAA", mime: "image/png", sizeBytes: 12 });
  });
  it("accepts exactly 4 MiB and rejects overflow", () => {
    const bytes = Buffer.alloc(MAX_IMAGE_BYTES);
    png.copy(bytes);
    expect(imageBytes(bytes).kind).toBe("ready");
    expect(imageBytes(Buffer.alloc(MAX_IMAGE_BYTES + 1))).toMatchObject({
      kind: "error",
      code: "too_large",
    });
    expect(
      imageWire({
        content: bytes.toString("base64"),
        contentEncoding: "base64",
        sizeBytes: 4194304,
      }).kind,
    ).toBe("ready");
  });
  it.each([
    ["ffd8ffe00000", "image/jpeg"],
    ["4749463839610000", "image/gif"],
    ["4749463837610000", "image/gif"],
    ["524946460000000057454250", "image/webp"],
  ])("recognizes %s by its signature", (hex, mime) => {
    expect(imageBytes(Buffer.from(hex, "hex"))).toMatchObject({ kind: "ready", mime });
  });
  it.each([
    { content: "!bad", contentEncoding: "base64", sizeBytes: 3 },
    { content: "iVBORw0KGgoAAAAA", contentEncoding: "base64", sizeBytes: 11 },
    { content: "iVBORw0KGgoAAAAA", contentEncoding: "utf8", sizeBytes: 12 },
    {
      content: Buffer.from("version https://git-lfs.github.com/spec/v1").toString("base64"),
      contentEncoding: "base64",
      sizeBytes: 42,
    },
  ])("rejects malformed, inconsistent and non-raster content", (value) => {
    expect(imageWire(value)).toMatchObject({ kind: "error", code: "unsupported" });
  });
});
