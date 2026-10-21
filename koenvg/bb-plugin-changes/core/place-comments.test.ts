import { describe, expect, it } from "vitest";
import { diffLines } from "../../review-ui/diff-lines";
import type { CommentAnchor } from "./pending-review";
import { placeByAnchor, type FileLines } from "./place-comments";

const LINES = diffLines("@@ -10,3 +40,3 @@\n keep\n-old\n+new\n keep\n");

function place(anchors: CommentAnchor[], files: Record<string, FileLines>) {
  return placeByAnchor(
    anchors,
    (anchor) => anchor,
    (path) => files[path] ?? "absent",
  );
}

function anchor(path: string, side: CommentAnchor["side"], line: number): CommentAnchor {
  return { path, side, line };
}

describe("placeByAnchor", () => {
  it("places new-side, old-side, and context-line anchors under their file", () => {
    const anchors = [
      anchor("a.ts", "additions", 41),
      anchor("a.ts", "deletions", 11),
      anchor("a.ts", "additions", 40),
    ];

    const placement = place(anchors, { "a.ts": LINES });

    expect(placement.byPath.get("a.ts")).toEqual(anchors);
    expect(placement.notInDiff).toEqual([]);
  });

  it("puts an anchor on a line outside the hunks in notInDiff", () => {
    const outside = anchor("a.ts", "additions", 99);

    expect(place([outside], { "a.ts": LINES }).notInDiff).toEqual([outside]);
  });

  it("puts an anchor on a file that is not in the diff in notInDiff", () => {
    const gone = anchor("b.ts", "additions", 1);

    expect(place([gone], { "a.ts": LINES }).notInDiff).toEqual([gone]);
  });

  it("keeps an anchor with its file while the patch is pending", () => {
    const waiting = anchor("a.ts", "additions", 99);

    expect(place([waiting], { "a.ts": "pending" }).byPath.get("a.ts")).toEqual([waiting]);
  });
});
