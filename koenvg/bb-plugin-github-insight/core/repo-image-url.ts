import { z } from "zod";
import { imagePathSchema, isRasterPath } from "./image-content";
import { imageRepoSchema } from "./pr-image-basis";

/** A commit SHA or a ref name without a slash, such as `main`. */
export const repoImageRefSchema = z.string().regex(/^[A-Za-z0-9._-]{1,200}$/);

export const repoImageRequestSchema = imageRepoSchema
  .extend({ ref: repoImageRefSchema, path: imagePathSchema })
  .strict();
export type RepoImageRequest = z.infer<typeof repoImageRequestSchema>;

/**
 * A raster image stored as a file in a GitHub repo, linked as
 * `github.com/<owner>/<repo>/raw/<ref>/<path>`, `github.com/<owner>/<repo>/blob/<ref>/<path>?raw=true`,
 * or `raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`. GitHub serves these with the
 * browser's GitHub login, so a private repo's image does not load in bb without the plugin.
 */
export function parseRepoImageUrl(value: string): RepoImageRequest | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").slice(1).map(decodePart);
  if (parts.some((part) => part === null)) return null;
  const segments = parts as string[];
  let owner: string | undefined;
  let repo: string | undefined;
  let ref: string | undefined;
  let path: string[];
  if (url.hostname === "github.com") {
    const [first, second, kind, third, ...rest] = segments;
    const raw = kind === "raw" || (kind === "blob" && url.searchParams.get("raw") === "true");
    if (!raw) return null;
    [owner, repo, ref, path] = [first, second, third, rest];
  } else if (url.hostname === "raw.githubusercontent.com") {
    const [first, second, third, ...rest] = segments;
    [owner, repo, ref, path] = [first, second, third, rest];
  } else {
    return null;
  }
  const request = repoImageRequestSchema.safeParse({ owner, repo, ref, path: path.join("/") });
  return request.success && isRasterPath(request.data.path) ? request.data : null;
}

function decodePart(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}
