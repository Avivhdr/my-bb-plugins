import { z } from "zod";
import { imageResultSchema } from "./image-content";

export const MAX_VIDEO_BYTES = 8 * 1024 * 1024;
const MAX_BASE64 = 4 * Math.ceil(MAX_VIDEO_BYTES / 3);
export const videoResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    content: z.string().max(MAX_BASE64),
    mime: z.enum(["video/mp4", "video/webm"]),
    sizeBytes: z.number().int().min(1).max(MAX_VIDEO_BYTES),
  }),
  imageResultSchema.options[1],
  imageResultSchema.options[2],
]);
export type VideoWireResult = z.infer<typeof videoResultSchema>;
export function videoError(
  code: Extract<VideoWireResult, { kind: "error" }>["code"],
  message: string,
): VideoWireResult {
  return { kind: "error", code, message };
}
export function isVideoPath(path: string): boolean {
  return /\.(mp4|webm)$/i.test(path);
}
export function videoBytes(bytes: Buffer): VideoWireResult {
  if (bytes.length > MAX_VIDEO_BYTES)
    return videoError(
      "too_large",
      "Video exceeds the 8 MiB preview limit. Use a local player for larger files.",
    );
  const mp4 =
    bytes.length >= 16 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(bytes.toString("ascii", 8, 12));
  const webm =
    bytes.subarray(0, 4).toString("hex") === "1a45dfa3" &&
    bytes.subarray(4, 4096).includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]));
  const mime = mp4 ? "video/mp4" : webm ? "video/webm" : null;
  return mime
    ? { kind: "ready", content: bytes.toString("base64"), mime, sizeBytes: bytes.length }
    : videoError(
        "unsupported",
        "Not a supported MP4 or WebM container. Use a local player for this file.",
      );
}
