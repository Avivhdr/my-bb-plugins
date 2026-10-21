import { describe, expect, it } from "vitest";
import { checkAnchor, diffLines, type Anchor } from "./diff-lines";
import type { ReviewFile } from "./pr-files";

const file: ReviewFile = {
  path: "src/a.ts",
  previousPath: null,
  status: "modified",
  patch: [
    "@@ -10,3 +10,4 @@",
    " keep",
    "-old",
    "+new",
    "+added",
    " tail",
    "@@ -40,2 +41,2 @@",
    " ctx",
    "-gone",
    "+here",
  ].join("\n"),
};

function anchor(fields: Partial<Anchor>): Anchor {
  return { path: "src/a.ts", side: "RIGHT", line: 11, startLine: null, ...fields };
}

describe("diffLines", () => {
  it("reads the new and old lines of each hunk", () => {
    const lines = diffLines(file.patch!);

    expect([...lines.additions]).toEqual([10, 11, 12, 13, 41, 42]);
    expect([...lines.deletions]).toEqual([10, 11, 12, 40, 41]);
  });
});

describe("checkAnchor", () => {
  it("accepts a single line in the diff", () => {
    expect(checkAnchor([file], anchor({ line: 12 }))).toEqual({ ok: true });
  });

  it("accepts a single line on the old side", () => {
    expect(checkAnchor([file], anchor({ side: "LEFT", line: 41 }))).toEqual({ ok: true });
  });

  it("accepts a range inside one hunk", () => {
    expect(checkAnchor([file], anchor({ startLine: 10, line: 13 }))).toEqual({ ok: true });
  });

  it("rejects a range across 2 hunks and names the ranges of that side", () => {
    expect(checkAnchor([file], anchor({ startLine: 12, line: 41 }))).toEqual({
      ok: false,
      reason:
        "Lines 12-41 are not all in the diff of src/a.ts on the RIGHT side. Diff ranges: 10-13, 41-42",
    });
  });

  it("rejects a line outside the diff and names the ranges of that side", () => {
    expect(checkAnchor([file], anchor({ side: "LEFT", line: 300 }))).toEqual({
      ok: false,
      reason: "Line 300 is not in the diff of src/a.ts on the LEFT side. Diff ranges: 10-12, 40-41",
    });
  });

  it("rejects a start line after the line", () => {
    expect(checkAnchor([file], anchor({ startLine: 13, line: 11 }))).toEqual({
      ok: false,
      reason: "Start line 13 is after line 11",
    });
  });

  it("rejects an unknown path", () => {
    expect(checkAnchor([file], anchor({ path: "src/missing.ts" }))).toEqual({
      ok: false,
      reason: "Not a file of this pull request: src/missing.ts",
    });
  });

  it("rejects a file without a patch", () => {
    expect(checkAnchor([{ ...file, patch: null }], anchor({}))).toEqual({
      ok: false,
      reason: "No diff available for src/a.ts",
    });
  });

  it("names no ranges when the side has no lines", () => {
    const deletionsOnly: ReviewFile = { ...file, patch: "@@ -20,2 +19,0 @@\n-a\n-b" };

    expect(checkAnchor([deletionsOnly], anchor({ line: 19 }))).toEqual({
      ok: false,
      reason: "Line 19 is not in the diff of src/a.ts on the RIGHT side. Diff ranges: none",
    });
  });
});
