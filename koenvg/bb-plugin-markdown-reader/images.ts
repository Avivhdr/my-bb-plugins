import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { extname } from "node:path";
import type { SourceAdapter } from "./source";

export interface ImageTarget {
  hostId: string;
  rootPath: string;
  path: string;
}

const endpoint = "/api/v1/plugins/markdown-reader/http/image";
const mimeTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
};

/** Each opaque URL binds one confined raster file. No registry or expiry timer. */
export function createImageTransport(read: SourceAdapter["read"]) {
  // Reload discards this generation's URLs. Refresh gets URLs from the new generation.
  const key = randomBytes(32);
  return {
    async urlFor(target: ImageTarget): Promise<string> {
      if (!mimeTypes[extname(target.path).toLowerCase()]) throw new Error("Unsupported image");
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(target), "utf8"),
        cipher.final(),
      ]);
      const asset = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
      return `${endpoint}?asset=${asset}`;
    },
    async serve(asset: string | null): Promise<Response> {
      try {
        if (!asset || !/^[a-z\d_-]+$/i.test(asset)) throw new Error("Invalid image URL");
        const bytes = Buffer.from(asset, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
        decipher.setAuthTag(bytes.subarray(12, 28));
        // Only urlFor can mint this authenticated payload. Callers cannot change its path/root/host.
        const target: ImageTarget = JSON.parse(
          Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"),
        );
        const mime = mimeTypes[extname(target.path).toLowerCase()];
        if (!mime) throw new Error("Unsupported image");
        // SDK checks the root and resolved symlinks on the selected source host on every GET.
        const file = await read(target);
        const body = Buffer.from(file.content, file.contentEncoding);
        return new Response(Uint8Array.from(body), {
          headers: {
            "content-type": mime,
            "cache-control": "no-store",
            "x-content-type-options": "nosniff",
            "content-security-policy": "default-src 'none'; sandbox",
          },
        });
      } catch {
        return new Response("Image unavailable. Refresh to retry.", {
          status: 404,
          headers: { "cache-control": "no-store" },
        });
      }
    },
  };
}
