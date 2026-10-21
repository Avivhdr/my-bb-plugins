import { describe, expect, it } from "vitest";
import recordedFiles from "../test/fixtures/pr-1-files.json";
import { collectPrFiles, gitPatch, parsePrFiles, type ReviewFile } from "./pr-files";

function restFile(fields: Record<string, unknown>) {
  return {
    sha: "abc",
    additions: 1,
    deletions: 1,
    changes: 2,
    blob_url: "https://github.com/o/r/blob/abc/a.ts",
    raw_url: "https://github.com/o/r/raw/abc/a.ts",
    contents_url: "https://api.github.com/repos/o/r/contents/a.ts",
    ...fields,
  };
}

describe("parsePrFiles", () => {
  it("reads path, status, and patch of a normal file", () => {
    const [file] = parsePrFiles([
      [restFile({ filename: "src/a.ts", status: "modified", patch: "@@ -1 +1 @@\n-a\n+b" })],
    ]);

    expect(file).toEqual({
      path: "src/a.ts",
      previousPath: null,
      status: "modified",
      patch: "@@ -1 +1 @@\n-a\n+b",
    });
  });

  it("keeps the old path of a renamed file", () => {
    const [file] = parsePrFiles([
      [
        restFile({
          filename: "src/b.ts",
          previous_filename: "src/a.ts",
          status: "renamed",
          patch: "@@ -1 +1 @@\n-a\n+b",
        }),
      ],
    ]);

    expect(file).toMatchObject({ path: "src/b.ts", previousPath: "src/a.ts", status: "renamed" });
  });

  it("gives a null patch for a file that GitHub sends without one", () => {
    const [file] = parsePrFiles([
      [restFile({ filename: "logo.png", status: "added", changes: 0 })],
    ]);

    expect(file).toMatchObject({ path: "logo.png", patch: null });
  });

  it("joins all pages in the order GitHub returns them", () => {
    const files = parsePrFiles([
      [restFile({ filename: "b.ts", status: "added" })],
      [restFile({ filename: "a.ts", status: "added" })],
    ]);

    expect(files.map((file) => file.path)).toEqual(["b.ts", "a.ts"]);
  });

  it("parses the recorded response", () => {
    expect(parsePrFiles(recordedFiles).map(({ path, patch }) => [path, patch !== null])).toEqual([
      ["plugins/github-insight/app.tsx", true],
      ["plugins/github-insight/core/pr-ref.ts", true],
      ["plugins/github-insight/package-lock.json", false],
    ]);
  });
});

describe("collectPrFiles", () => {
  function fullPage(prefix: string) {
    return Array.from({ length: 100 }, (_, index) =>
      restFile({ filename: `${prefix}-${index}.ts`, status: "added" }),
    );
  }

  it("asks for the next page while GitHub returns full pages", async () => {
    const pages = [fullPage("a"), fullPage("b"), [restFile({ filename: "c.ts", status: "added" })]];
    const requested: number[] = [];

    const files = await collectPrFiles(async (page) => {
      requested.push(page);
      return pages[page - 1];
    });

    expect(requested).toEqual([1, 2, 3]);
    expect(files).toHaveLength(201);
  });

  it("stops at the 3000 files GitHub lists", async () => {
    const requested: number[] = [];

    await collectPrFiles(async (page) => {
      requested.push(page);
      return fullPage(`p${page}`);
    });

    expect(requested).toHaveLength(30);
  });
});

describe("gitPatch", () => {
  const hunk = "@@ -1 +1 @@\n-a\n+b";

  function file(fields: Partial<ReviewFile>): ReviewFile {
    return { path: "src/a.ts", previousPath: null, status: "modified", patch: hunk, ...fields };
  }

  it("adds the file headers to a modified file", () => {
    expect(gitPatch(file({}))).toBe(
      `diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n${hunk}\n`,
    );
  });

  it("marks an added file as new", () => {
    expect(gitPatch(file({ status: "added" }))).toBe(
      `diff --git a/src/a.ts b/src/a.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/a.ts\n${hunk}\n`,
    );
  });

  it("marks a removed file as deleted", () => {
    expect(gitPatch(file({ status: "removed" }))).toBe(
      `diff --git a/src/a.ts b/src/a.ts\ndeleted file mode 100644\n--- a/src/a.ts\n+++ /dev/null\n${hunk}\n`,
    );
  });

  it("names both paths of a renamed file", () => {
    expect(gitPatch(file({ path: "src/b.ts", previousPath: "src/a.ts", status: "renamed" }))).toBe(
      `diff --git a/src/a.ts b/src/b.ts\nrename from src/a.ts\nrename to src/b.ts\n--- a/src/a.ts\n+++ b/src/b.ts\n${hunk}\n`,
    );
  });

  it("names both paths of a copied file", () => {
    expect(gitPatch(file({ path: "src/b.ts", previousPath: "src/a.ts", status: "copied" }))).toBe(
      `diff --git a/src/a.ts b/src/b.ts\ncopy from src/a.ts\ncopy to src/b.ts\n--- a/src/a.ts\n+++ b/src/b.ts\n${hunk}\n`,
    );
  });

  it("gives null for a file without a patch", () => {
    expect(gitPatch(file({ patch: null }))).toBeNull();
  });
});
