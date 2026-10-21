import { describe, expect, it } from "vitest";
import type { ChangedFile } from "./changes";
import { patchIdentity } from "./patch-identity";
import { viewedSummary } from "./viewed-files";

const PATCH = "@@ -1,3 +1,3 @@\n keep\n-old\n+new\n keep\n";
const SAME_COUNTS_EDIT = "@@ -1,3 +1,3 @@\n keep\n-old\n+newer\n keep\n";

function file(path: string, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return {
    path,
    previousPath: null,
    additions: 1,
    deletions: 1,
    binary: false,
    loadMode: "auto",
    status: "modified",
    ...overrides,
  };
}

describe("viewedSummary", () => {
  const patches: Record<string, string> = { "src/a.ts": PATCH, "src/b.ts": PATCH };
  const currentPatch = (path: string) => patches[path] ?? null;

  it("counts only files that can be marked", () => {
    const files = [
      file("src/a.ts"),
      file("src/b.ts"),
      file("logo.png", { binary: true }),
      file("big.json", { loadMode: "too_large" }),
    ];

    const summary = viewedSummary(files, { "src/a.ts": patchIdentity(PATCH) }, currentPatch);

    expect(summary).toEqual({ viewed: new Set(["src/a.ts"]), markable: 2, stale: [] });
  });

  it("marks a file with a changed patch as stale", () => {
    const summary = viewedSummary(
      [file("src/a.ts")],
      { "src/a.ts": patchIdentity(SAME_COUNTS_EDIT) },
      currentPatch,
    );

    expect(summary.viewed.size).toBe(0);
    expect(summary.stale).toEqual(["src/a.ts"]);
  });

  it("marks a file that left the diff as stale", () => {
    const summary = viewedSummary(
      [file("src/b.ts")],
      { "src/a.ts": patchIdentity(PATCH) },
      currentPatch,
    );

    expect(summary.stale).toEqual(["src/a.ts"]);
  });

  it("does not count or prune a marked file whose patch is not loaded", () => {
    const summary = viewedSummary(
      [file("src/c.ts", { loadMode: "on_demand" })],
      { "src/c.ts": patchIdentity(PATCH) },
      currentPatch,
    );

    expect(summary).toEqual({ viewed: new Set(), markable: 1, stale: [] });
  });

  it("prunes a mark on a file that became binary", () => {
    const summary = viewedSummary(
      [file("src/a.ts", { binary: true })],
      { "src/a.ts": patchIdentity(PATCH) },
      currentPatch,
    );

    expect(summary.stale).toEqual(["src/a.ts"]);
  });
});
