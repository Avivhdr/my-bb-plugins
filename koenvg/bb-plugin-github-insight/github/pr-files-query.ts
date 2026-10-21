import { z } from "zod";
import type { PrFilesPageRequest } from "../contract";
import { PR_FILES_PER_PAGE } from "../core/pr-files";

// bb rejects host output above 8 MiB.
export const PR_FILES_PAGE_MAX_BYTES = 6 * 1024 * 1024;

const pageFileSchema = z.object({
  filename: z.string(),
  previous_filename: z.string().optional(),
  status: z.string(),
  patch: z.string().optional(),
});
type PageFile = z.infer<typeof pageFileSchema>;

export function prFilesPageArgs({ owner, repo, number, page }: PrFilesPageRequest): string[] {
  return [
    "api",
    `repos/${owner}/${repo}/pulls/${number}/files?per_page=${PR_FILES_PER_PAGE}&page=${page}`,
  ];
}

export function fitPrFilesPage(response: unknown, maxBytes = PR_FILES_PAGE_MAX_BYTES): PageFile[] {
  const files = z.array(pageFileSchema).parse(response);
  let bytes = jsonBytes(files);
  const byPatchSize = files
    .filter((file) => file.patch !== undefined)
    .sort((a, b) => jsonBytes(b.patch) - jsonBytes(a.patch));
  for (const file of byPatchSize) {
    if (bytes <= maxBytes) break;
    bytes -= jsonBytes(file.patch) + jsonBytes("patch") + 2;
    delete file.patch;
  }
  return files;
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}
