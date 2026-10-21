import { describe, expect, it } from "vitest";
import { fitPrFilesPage, prFilesPageArgs } from "./pr-files-query";

function file(filename: string, patchBytes: number) {
  return { filename, status: "modified", sha: "abc", patch: "+".repeat(patchBytes) };
}

describe("prFilesPageArgs", () => {
  it("asks for one page of 100 files", () => {
    expect(prFilesPageArgs({ owner: "o", repo: "r", number: 7, page: 3 })).toEqual([
      "api",
      "repos/o/r/pulls/7/files?per_page=100&page=3",
    ]);
  });
});

describe("fitPrFilesPage", () => {
  it("keeps only the fields the review reads", () => {
    expect(fitPrFilesPage([file("a.ts", 3)])).toEqual([
      { filename: "a.ts", status: "modified", patch: "+++" },
    ]);
  });

  it("drops the largest patches until the page fits the byte budget", () => {
    const page = fitPrFilesPage(
      [file("small.ts", 10), file("big.ts", 900), file("mid.ts", 500)],
      700,
    );

    expect(page.map((entry) => [entry.filename, entry.patch?.length ?? null])).toEqual([
      ["small.ts", 10],
      ["big.ts", null],
      ["mid.ts", 500],
    ]);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(700);
  });
});
