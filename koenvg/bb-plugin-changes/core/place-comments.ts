import type { DiffLines } from "../../review-ui/diff-lines";
import type { CommentAnchor } from "./pending-review";

export type FileLines = DiffLines | "pending" | "absent";

export interface Placement<T> {
  byPath: ReadonlyMap<string, T[]>;
  notInDiff: T[];
}

export function placeByAnchor<T>(
  items: Iterable<T>,
  anchorOf: (item: T) => CommentAnchor,
  linesOf: (path: string) => FileLines,
): Placement<T> {
  const byPath = new Map<string, T[]>();
  const notInDiff: T[] = [];
  for (const item of items) {
    const { path, side, line } = anchorOf(item);
    const lines = linesOf(path);
    const placed = lines === "pending" || (lines !== "absent" && lines[side].has(line));
    if (!placed) {
      notInDiff.push(item);
      continue;
    }
    const group = byPath.get(path);
    if (group === undefined) byPath.set(path, [item]);
    else group.push(item);
  }
  return { byPath, notInDiff };
}
