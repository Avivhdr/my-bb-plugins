import { isRasterPath } from "./image-content";
import { z } from "zod";
import { patchIdentity } from "./patch-identity";
import { gitPatch, type ReviewFile } from "./pr-files";

export const viewedMarksSchema = z.record(z.string(), z.string());
export type ViewedMarks = Readonly<z.infer<typeof viewedMarksSchema>>;

export const storedViewedSchema = z.object({ v: z.literal(1), marks: viewedMarksSchema });

export function fileIdentity(file: ReviewFile): string | null {
  if (isRasterPath(file.path) || isRasterPath(file.previousPath ?? "")) return null;
  const patch = gitPatch(file);
  return patch === null ? null : patchIdentity(patch);
}

export function fileIdentities(files: readonly ReviewFile[]): ReadonlyMap<string, string | null> {
  return new Map(files.map((file) => [file.path, fileIdentity(file)]));
}

export interface ViewedSummary {
  viewed: ReadonlySet<string>;
  markable: number;
  stale: readonly string[];
}

export function viewedSummary(
  identities: ReadonlyMap<string, string | null>,
  marks: ViewedMarks,
): ViewedSummary {
  const viewed = new Set<string>();
  const stale: string[] = [];
  for (const [path, identity] of Object.entries(marks)) {
    if (identities.get(path) === identity) viewed.add(path);
    else stale.push(path);
  }
  const markable = [...identities.values()].filter((identity) => identity !== null).length;
  return { viewed, markable, stale };
}
