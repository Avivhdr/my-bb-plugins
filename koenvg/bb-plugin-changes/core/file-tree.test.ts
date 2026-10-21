import { describe, expect, it } from "vitest";
import type { ChangedFile } from "./changes";
import { compareFilePaths } from "./file-order";
import { buildFileTree, visibleRows, type FileTreeRow } from "./file-tree";

function file(path: string, previousPath: string | null = null): ChangedFile {
  return {
    path,
    previousPath,
    additions: 1,
    deletions: 0,
    binary: false,
    loadMode: "auto",
    status: "modified",
  };
}

function labels(rows: readonly FileTreeRow[]): string[] {
  return rows.map((row) => `${row.depth}:${row.kind === "folder" ? `${row.label}/` : row.label}`);
}

describe("buildFileTree", () => {
  it("joins a chain of single folders into one row", () => {
    expect(labels(buildFileTree([file("src/ui/lib/a.ts"), file("src/ui/lib/b.ts")]))).toEqual([
      "0:src/ui/lib/",
      "1:a.ts",
      "1:b.ts",
    ]);
  });

  it("puts a root file at depth 0 after the folders", () => {
    expect(labels(buildFileTree([file("README.md"), file("src/a.ts")]))).toEqual([
      "0:src/",
      "1:a.ts",
      "0:README.md",
    ]);
  });

  it("keeps a folder with two child folders as its own row", () => {
    expect(labels(buildFileTree([file("src/ui/a.ts"), file("src/core/b.ts")]))).toEqual([
      "0:src/",
      "1:core/",
      "2:b.ts",
      "1:ui/",
      "2:a.ts",
    ]);
  });

  it("keeps a folder that holds a file and a folder as its own row", () => {
    expect(labels(buildFileTree([file("src/ui/a.ts"), file("src/b.ts")]))).toEqual([
      "0:src/",
      "1:ui/",
      "2:a.ts",
      "1:b.ts",
    ]);
  });

  it("lists a file and a folder with the same name in section order", () => {
    const files = [file("foo"), file("foo/bar.ts")];

    expect(labels(buildFileTree(files))).toEqual(["0:foo/", "1:bar.ts", "0:foo"]);
    expect(
      buildFileTree(files).flatMap((row) => (row.kind === "file" ? [row.file.path] : [])),
    ).toEqual(files.map((f) => f.path).sort(compareFilePaths));
  });

  it("shows a renamed file at its new path", () => {
    const rows = buildFileTree([file("src/new.ts", "old/old.ts")]);

    expect(labels(rows)).toEqual(["0:src/", "1:new.ts"]);
    expect(rows[1]).toMatchObject({ kind: "file", file: { path: "src/new.ts" } });
  });
});

describe("visibleRows", () => {
  const rows = buildFileTree([
    file("src/core/a.ts"),
    file("src/ui/b.ts"),
    file("src/c.ts"),
    file("README.md"),
  ]);

  it("returns all rows when nothing is collapsed", () => {
    expect(visibleRows(rows, new Set())).toEqual(rows);
  });

  it("hides every deeper row under a collapsed folder", () => {
    expect(labels(visibleRows(rows, new Set(["src"])))).toEqual(["0:src/", "0:README.md"]);
  });

  it("hides only the rows of a collapsed nested folder", () => {
    expect(labels(visibleRows(rows, new Set(["src/core"])))).toEqual([
      "0:src/",
      "1:core/",
      "1:ui/",
      "2:b.ts",
      "1:c.ts",
      "0:README.md",
    ]);
  });
});
