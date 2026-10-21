import { describe, expect, it } from "vitest";
import { commentAnchorLine, diffLines } from "./diff-lines";

describe("diffLines", () => {
  it("puts context lines on both sides and changed lines on their own side", () => {
    const lines = diffLines(
      "diff --git a/a.ts b/a.ts\n@@ -10,3 +20,3 @@\n keep\n-old\n+new\n keep\n",
    );

    expect([...lines.deletions]).toEqual([10, 11, 12]);
    expect([...lines.additions]).toEqual([20, 21, 22]);
  });

  it("restarts the numbers at every hunk header", () => {
    const lines = diffLines("@@ -1 +1 @@\n-a\n+b\n@@ -50,0 +50,1 @@\n+c\n");

    expect([...lines.additions]).toEqual([1, 50]);
    expect([...lines.deletions]).toEqual([1]);
  });
});

describe("commentAnchorLine", () => {
  const lines = diffLines("@@ -10,3 +20,3 @@\n keep\n-old\n+new\n keep\n");

  it("moves a context line clicked on the old side to its new line", () => {
    expect(commentAnchorLine(lines, "deletions", 10)).toEqual({ side: "additions", line: 20 });
  });

  it("keeps a deleted line on the old side", () => {
    expect(commentAnchorLine(lines, "deletions", 11)).toEqual({ side: "deletions", line: 11 });
  });

  it("keeps a new-side line as it is", () => {
    expect(commentAnchorLine(lines, "additions", 21)).toEqual({ side: "additions", line: 21 });
  });
});
