import { describe, expect, it } from "vitest";
import { videoBytes, videoResultSchema, isVideoPath, MAX_VIDEO_BYTES } from "./video-content";

const mp4 = Buffer.from("000000186674797069736f6d0000000069736f6d6d703432", "hex");
const webm = Buffer.from("1a45dfa38b4282847765626d42878104", "hex");
describe("video preview boundary", () => {
  it.each([
    [mp4, "video/mp4"],
    [webm, "video/webm"],
  ])("accepts a supported container", (bytes, mime) => {
    expect(videoBytes(bytes as Buffer)).toEqual({
      kind: "ready",
      content: (bytes as Buffer).toString("base64"),
      mime,
      sizeBytes: (bytes as Buffer).length,
    });
  });
  it("recognizes only MP4 and WebM paths", () => {
    expect(["clip.MP4", "clip.webm", "clip.mov", "clip.avi", "clip.svg"].map(isVideoPath)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
  it("rejects empty, disguised and oversized data", () => {
    for (const bytes of [
      Buffer.alloc(0),
      Buffer.from("not a video"),
      Buffer.from("1a45dfa36d6174726f736b61", "hex"),
    ])
      expect(videoBytes(bytes)).toMatchObject({ kind: "error", code: "unsupported" });
    expect(videoBytes(Buffer.alloc(MAX_VIDEO_BYTES + 1))).toMatchObject({
      kind: "error",
      code: "too_large",
    });
  });
  it("bounds the public RPC result", () => {
    expect(videoResultSchema.parse(videoBytes(mp4))).toMatchObject({
      kind: "ready",
      mime: "video/mp4",
    });
    expect(
      videoResultSchema.safeParse({
        kind: "ready",
        content: "",
        mime: "video/mp4",
        sizeBytes: MAX_VIDEO_BYTES + 1,
      }).success,
    ).toBe(false);
  });
});
