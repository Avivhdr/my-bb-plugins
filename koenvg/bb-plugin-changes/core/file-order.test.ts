import { describe, expect, it } from "vitest";
import { compareFilePaths } from "./file-order";

describe("compareFilePaths", () => {
  it("puts folders before files at every level", () => {
    expect(["README.md", "src/b.ts", "src/ui/a.ts"].sort(compareFilePaths)).toEqual([
      "src/ui/a.ts",
      "src/b.ts",
      "README.md",
    ]);
  });

  it("sorts by name within a level", () => {
    expect(["src/c.ts", "src/a.ts", "src/b.ts"].sort(compareFilePaths)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
  });

  it("puts a folder before a file with the same name", () => {
    expect(["foo", "foo/bar.ts"].sort(compareFilePaths)).toEqual(["foo/bar.ts", "foo"]);
  });

  it("treats equal paths as equal", () => {
    expect(compareFilePaths("src/a.ts", "src/a.ts")).toBe(0);
  });
});
