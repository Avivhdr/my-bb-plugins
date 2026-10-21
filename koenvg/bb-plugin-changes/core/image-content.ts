import { z } from "zod";

export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const imageSideSchema = z.enum(["before", "after"]);
export type ImageSide = z.infer<typeof imageSideSchema>;
export const imageResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    content: z.string().max(5592408),
    mime: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]),
    sizeBytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
  }),
  z.object({
    kind: z.literal("error"),
    code: z.enum(["unsupported", "too_large", "read", "stale", "decode", "auth", "missing"]),
    message: z.string(),
  }),
  z.object({ kind: z.literal("absent") }),
]);
export type ImageWireResult = z.infer<typeof imageResultSchema>;
export const imagePathSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.includes("\\") &&
      Array.from(path).every(
        (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      ) &&
      path.split("/").every((part) => part !== ".." && part !== "." && part !== ""),
  );
export const imageShaSchema = z.string().regex(/^[a-f0-9]{40}$/i);
export function imageError(
  code: Extract<ImageWireResult, { kind: "error" }>["code"],
  message: string,
): ImageWireResult {
  return { kind: "error", code, message };
}
export function isRasterPath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path);
}
export function imagePath(
  file: { path: string; previousPath: string | null; status: string },
  side: ImageSide,
): string | null {
  if (side === "before" && ["added", "untracked"].includes(file.status)) return null;
  if (side === "after" && ["deleted", "removed"].includes(file.status)) return null;
  const path =
    side === "before" && ["renamed", "copied"].includes(file.status)
      ? file.previousPath
      : file.path;
  return imagePathSchema.parse(path);
}
export function imageBytes(bytes: Buffer): ImageWireResult {
  if (bytes.length > MAX_IMAGE_BYTES)
    return imageError("too_large", "Image exceeds the 4 MiB preview limit");
  const hex = bytes.subarray(0, 12).toString("hex");
  const mime = hex.startsWith("89504e470d0a1a0a")
    ? "image/png"
    : hex.startsWith("ffd8ff")
      ? "image/jpeg"
      : /^(474946383761|474946383961)/.test(hex)
        ? "image/gif"
        : hex.startsWith("52494646") && hex.slice(16) === "57454250"
          ? "image/webp"
          : null;
  return mime
    ? { kind: "ready", content: bytes.toString("base64"), mime, sizeBytes: bytes.length }
    : imageError("unsupported", "Not a supported raster image (PNG, JPEG, GIF or WebP)");
}
export function imageWire(value: {
  content: string;
  contentEncoding: string;
  sizeBytes: number;
}): ImageWireResult {
  if (value.sizeBytes > MAX_IMAGE_BYTES || value.content.length > 5592408)
    return imageError("too_large", "Image exceeds the 4 MiB preview limit");
  if (
    value.contentEncoding !== "base64" ||
    !Number.isInteger(value.sizeBytes) ||
    value.sizeBytes < 1 ||
    value.content.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.content)
  )
    return imageError("unsupported", "Invalid image encoding");
  const bytes = Buffer.from(value.content, "base64");
  if (bytes.length !== value.sizeBytes || bytes.toString("base64") !== value.content)
    return imageError("unsupported", "Invalid image size or encoding");
  return imageBytes(bytes);
}
