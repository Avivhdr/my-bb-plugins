import { describe, expect, it } from "vitest";
import { patchIdentity } from "./patch-identity";
import { gitPatch, type ReviewFile } from "./pr-files";
import { fileIdentities, viewedSummary } from "./viewed-marks";

const PATCH = "@@ -1,3 +1,3 @@\n keep\n-old\n+new\n keep";

function file(path: string, patch: string | null = PATCH): ReviewFile {
  return { path, previousPath: null, status: "modified", patch };
}

function identityOf(reviewFile: ReviewFile): string {
  return patchIdentity(gitPatch(reviewFile)!);
}

describe("fileIdentities", () => {
  it("gives no identity to a file without a patch", () => {
    const identities = fileIdentities([file("a.ts"), file("logo.png", null)]);

    expect(identities.get("a.ts")).toBe(identityOf(file("a.ts")));
    expect(identities.get("logo.png")).toBeNull();
  });
});

describe("viewedSummary", () => {
  it("counts a mark with the same patch as viewed", () => {
    const a = file("a.ts");

    const summary = viewedSummary(fileIdentities([a, file("b.ts")]), { "a.ts": identityOf(a) });

    expect([...summary.viewed]).toEqual(["a.ts"]);
    expect(summary.markable).toBe(2);
    expect(summary.stale).toEqual([]);
  });

  it("drops a mark when the patch changed", () => {
    const before = file("a.ts");
    const after = file("a.ts", PATCH.replace("+new", "+newer"));

    const summary = viewedSummary(fileIdentities([after]), { "a.ts": identityOf(before) });

    expect(summary.viewed.size).toBe(0);
    expect(summary.stale).toEqual(["a.ts"]);
  });

  it("drops a mark when the file status changed", () => {
    const modified = file("a.ts");
    const added: ReviewFile = { ...modified, status: "added" };

    const summary = viewedSummary(fileIdentities([added]), { "a.ts": identityOf(modified) });

    expect(summary.stale).toEqual(["a.ts"]);
  });

  it("drops a mark on a file that is not in the PR", () => {
    const summary = viewedSummary(fileIdentities([file("b.ts")]), {
      "a.ts": identityOf(file("a.ts")),
    });

    expect(summary.stale).toEqual(["a.ts"]);
  });

  it("drops a mark on a file without a patch and does not count the file", () => {
    const summary = viewedSummary(fileIdentities([file("a.ts"), file("logo.png", null)]), {
      "logo.png": "1:aa",
    });

    expect(summary.stale).toEqual(["logo.png"]);
    expect(summary.markable).toBe(1);
  });
});
