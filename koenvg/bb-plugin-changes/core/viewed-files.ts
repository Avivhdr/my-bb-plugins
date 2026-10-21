import { isRasterPath } from "./image-content";
import { z } from "zod";
import { patchIdentity } from "./patch-identity";
import type { ChangedFile } from "./changes";

export const viewedMarksSchema = z.record(z.string(), z.string());
export type ViewedMarks = Readonly<z.infer<typeof viewedMarksSchema>>;

export const storedViewedSchema = z.object({ v: z.literal(1), marks: viewedMarksSchema });

export const getViewedResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), marks: viewedMarksSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type GetViewedResult = z.infer<typeof getViewedResultSchema>;

export const updateViewedResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("error"), message: z.string() }),
]);
export type UpdateViewedResult = z.infer<typeof updateViewedResultSchema>;

export function canMark(file: ChangedFile): boolean {
  return (
    !isRasterPath(file.path) &&
    !isRasterPath(file.previousPath ?? "") &&
    !file.binary &&
    file.loadMode !== "too_large"
  );
}

export interface ViewedSummary {
  viewed: ReadonlySet<string>;
  markable: number;
  stale: readonly string[];
}

export function viewedSummary(
  files: readonly ChangedFile[],
  marks: ViewedMarks,
  currentPatch: (path: string) => string | null,
): ViewedSummary {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const viewed = new Set<string>();
  const stale: string[] = [];
  for (const [path, identity] of Object.entries(marks)) {
    const file = byPath.get(path);
    if (file === undefined || !canMark(file)) {
      stale.push(path);
      continue;
    }
    const patch = currentPatch(path);
    if (patch === null) continue;
    if (patchIdentity(patch) === identity) viewed.add(path);
    else stale.push(path);
  }
  return { viewed, markable: files.filter(canMark).length, stale };
}
