import { posix, win32 } from "node:path";
import type { ReaderTarget } from "./source";
import { MAX_IMAGES, type Destination, type DestinationRequest } from "./destination-types";

export interface DocumentLocation {
  target: ReaderTarget;
  hostId: string;
  rootPath: string;
  documentPath: string;
  environmentId?: string | null;
}
type LocalImage = { kind: "local-image"; relative: string };
type Resolved = Destination | LocalImage;
const rejected = (reason = "Unsupported or unsafe destination."): Destination => ({
  kind: "rejected",
  reason,
});
const raster = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i;

// Called after URL decoding succeeds. Share the encoded-path policy for all destinations.
function unsafeEncodedPath(encodedPath: string): boolean {
  return (
    decodeURIComponent(encodedPath).includes("%") ||
    /%2f|%5c/i.test(encodedPath) ||
    encodedPath
      .split("/")
      .some((part) => part.includes("%") && [".", ".."].includes(decodeURIComponent(part)))
  );
}
/** One policy, used only after the source module has selected the actual host/root. */
function resolve(location: DocumentLocation, { url, image }: DestinationRequest): Resolved {
  if (!url || url.trim() !== url || /[\x00-\x20\x7f\\]/.test(url)) return rejected();
  let decoded: string;
  try {
    decoded = decodeURIComponent(url);
  } catch {
    return rejected();
  }
  if (/[\x00-\x1f\x7f\\]/.test(decoded) || /[\ud800-\udfff]/u.test(decoded)) return rejected();
  if (/^https?:\/\//i.test(url)) {
    if (!/^https?:\/\/[^/?#]+(?:[/?#]|$)/i.test(url) || decoded.includes("%")) return rejected();
    const encodedPath = url.replace(/^https?:\/\/[^/?#]+/i, "").split(/[?#]/, 1)[0]!;
    if (unsafeEncodedPath(encodedPath)) return rejected();
    try {
      const external = new URL(url);
      if (!external.hostname || external.username || external.password) return rejected();
      if (image && /\.(svg|html?|pdf|tiff?)$/i.test(external.pathname)) return rejected();
      return image
        ? { kind: "image", remote: true, url: external.href }
        : { kind: "external-url", url: external.href };
    } catch {
      return rejected();
    }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("/") || decoded.includes("?"))
    return rejected();
  const hash = url.indexOf("#");
  const encodedPath = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? "" : url.slice(hash);
  if (!encodedPath) return !image && fragment ? { kind: "fragment", fragment } : rejected();
  let path: string;
  try {
    path = decodeURIComponent(encodedPath);
  } catch {
    return rejected();
  }
  // Do not permit encoded separators, encoded dot traversal, nested encodings or ADS.
  if (path.includes(":") || unsafeEncodedPath(encodedPath)) return rejected();
  const paths = /^[a-z]:[\\/]|^\\\\/i.test(location.rootPath) ? win32 : posix;
  const absolute = paths.resolve(paths.dirname(location.documentPath), ...path.split("/"));
  const relative = paths.relative(location.rootPath, absolute);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${paths.sep}`) ||
    paths.isAbsolute(relative)
  )
    return rejected();
  if (!image && absolute === location.documentPath && fragment)
    return { kind: "fragment", fragment };
  if (image)
    return !fragment && raster.test(path)
      ? { kind: "local-image", relative: relative.split(paths.sep).join("/") }
      : rejected();
  // The SDK has no heading-fragment file-open location. Do not invent source lines.
  if (fragment)
    return rejected("Cross-file heading fragments are not supported by BB file navigation.");
  const source = location.target.source;
  if (source.kind === "workspace")
    return location.environmentId
      ? {
          kind: "local-file",
          hostId: location.hostId,
          target: {
            kind: "workspace",
            environmentId: location.environmentId,
            path: relative.split(paths.sep).join("/"),
          },
        }
      : rejected("BB file navigation needs a workspace environment. Use BB preview.");
  if (source.kind === "thread-storage" && source.threadId)
    return {
      kind: "local-file",
      hostId: location.hostId,
      target: {
        kind: "thread-storage",
        threadId: source.threadId,
        path: relative.split(paths.sep).join("/"),
      },
    };
  return {
    kind: "local-file",
    hostId: location.hostId,
    target: { kind: "host", hostId: location.hostId, path: absolute },
  };
}

export async function resolveDestinations(
  location: DocumentLocation,
  requests: DestinationRequest[],
  imageUrl?: (target: { hostId: string; rootPath: string; path: string }) => Promise<string>,
): Promise<Destination[]> {
  const images = new Set<string>();
  const localUrls = new Map<string, Promise<Destination>>();
  return Promise.all(
    requests.map(async (request) => {
      const result = resolve(location, request);
      if (result.kind === "local-image" || result.kind === "image") {
        const key = result.kind === "local-image" ? result.relative : result.url;
        if (!images.has(key) && images.size >= MAX_IMAGES)
          return rejected("This document exceeds the 32-image limit.");
        images.add(key);
      }
      if (result.kind !== "local-image") return result;
      if (!localUrls.has(result.relative)) {
        localUrls.set(
          result.relative,
          (async (): Promise<Destination> => {
            try {
              if (!imageUrl) throw new Error("Image transport unavailable");
              const paths = /^[a-z]:[\\/]|^\\\\/i.test(location.rootPath) ? win32 : posix;
              const url = await imageUrl({
                hostId: location.hostId,
                rootPath: location.rootPath,
                path: paths.resolve(location.rootPath, ...result.relative.split("/")),
              });
              if (
                !/^\/api\/v1\/plugins\/markdown-reader\/http\/image\?asset=[a-z\d_-]+$/i.test(url)
              )
                throw new Error("Invalid image transport");
              return { kind: "image", remote: false, url };
            } catch {
              return rejected("Image preview is unavailable. Refresh to retry.");
            }
          })(),
        );
      }
      return localUrls.get(result.relative)!;
    }),
  );
}
