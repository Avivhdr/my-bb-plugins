import { describe, expect, it } from "vitest";
import { processFile } from "@pierre/diffs";
import {
  contextFailure,
  textRevisions,
  validateContext,
  validatePatch,
  validateText,
  type Snapshot,
} from "./text-context";
import type { ChangedFile } from "./changes";

const file: ChangedFile = {
  path: "a.txt",
  previousPath: null,
  status: "modified",
  binary: false,
  loadMode: "auto",
  additions: 1,
  deletions: 1,
};
const header = "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n";
const patch = header + "@@ -2,3 +2,3 @@\n before\n-old\n+new\n after\n";
const oldText = "prefix\nbefore\nold\nafter\nsuffix\n";
const newText = "prefix\nbefore\nnew\nafter\nsuffix\n";
const snapshot: Snapshot = {
  threadId: "thread",
  basis: {
    environmentId: "env",
    headSha: "a".repeat(40),
    mergeBaseRef: "b".repeat(40),
    target: { kind: "all" },
  },
  generation: 1,
  file,
  patch,
};
function pair(old = oldText, after = newText) {
  const refs = textRevisions(snapshot.basis, file);
  return {
    kind: "ready",
    old: {
      kind: "text",
      revision: refs.old,
      contents: old,
      sizeBytes: new TextEncoder().encode(old).length,
    },
    new: {
      kind: "text",
      revision: refs.new,
      contents: after,
      sizeBytes: new TextEncoder().encode(after).length,
    },
  };
}
function rejected(run: () => unknown) {
  try {
    run();
    return "accepted";
  } catch (error) {
    return contextFailure(error).message;
  }
}
const STALE = "Context does not match this diff. Refresh changes.";

describe("complete text context", () => {
  it("retains original hunks and enables native expansion with complete prefix and suffix", () => {
    const texts = validateContext(snapshot, pair());
    const diff = processFile(patch, {
      oldFile: { name: "a.txt", contents: texts.old },
      newFile: { name: "a.txt", contents: texts.new },
      throwOnError: true,
    })!;
    expect({
      partial: diff.isPartial,
      old: diff.deletionLines.join(""),
      new: diff.additionLines.join(""),
      start: diff.hunks[0]!.additionStart,
    }).toEqual({ partial: false, old: oldText, new: newText, start: 2 });
  });
  it.each(["prefix", "gap", "suffix"])("rejects drift outside the patch in the %s", (position) => {
    const p =
      position === "gap"
        ? header + "@@ -2 +2 @@\n-before\n+BEFORE\n@@ -4 +4 @@\n-after\n+AFTER\n"
        : patch;
    const after =
      position === "gap"
        ? "prefix\nBEFORE\nDRIFT\nAFTER\nsuffix\n"
        : newText.replace(position, "DRIFT");
    expect(rejected(() => validatePatch(file, p, oldText, after))).toBe(STALE);
  });
  it.each([
    ["deleted text", patch.replace("-old", "-wrong")],
    ["context text", patch.replace(" before", " wrong")],
    ["coordinates", patch.replace("-2,3", "-1,3")],
    ["new coordinates", patch.replace("+2,3", "+3,3")],
    ["counts", patch.replace("-2,3", "-2,4")],
    ["unsafe count", patch.replace("-2,3", "-9007199254740999,3")],
    ["overlapping hunks", patch + "@@ -2 +2 @@\n-before\n+new\n"],
    ["wrong path", patch.replace("+++ b/a.txt", "+++ b/other.txt")],
    ["binary metadata", patch.replace("--- a", "GIT binary patch\n--- a")],
    ["multiple files", patch + patch],
    ["wrong status", patch.replace("--- a", "new file mode 100644\n--- a")],
    ["unexpected trailing data", patch + "garbage\n"],
  ])("rejects %s instead of relocating or rediffing", (_name, p) => {
    expect(rejected(() => validatePatch(file, p, oldText, newText))).toBe(STALE);
  });
  it("preserves CRLF and missing final newlines exactly", () => {
    const p = header + "@@ -1,2 +1,2 @@\n keep\r\n-old\r\n+new\r\n";
    validatePatch(file, p, "keep\r\nold\r\n", "keep\r\nnew\r\n");
    const eof =
      header +
      "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\n\\ No newline at end of file\n";
    validatePatch(file, eof, "old", "new");
    expect(rejected(() => validatePatch(file, eof, "old\n", "new"))).toBe(STALE);
    expect(rejected(() => validatePatch(file, p, "keep\nold\n", "keep\nnew\n"))).toBe(STALE);
  });
  it("handles zero-count insertion, deletion, absent additions and empty files", () => {
    validatePatch(file, header + "@@ -1,0 +2 @@\n+insert\n", "a\nz\n", "a\ninsert\nz\n");
    validatePatch(file, header + "@@ -2 +1,0 @@\n-delete\n", "a\ndelete\nz\n", "a\nz\n");
    const added = { ...file, status: "untracked" as const };
    const p = header.replace("--- a/a.txt", "--- /dev/null") + "@@ -0,0 +1 @@\n+new\n";
    validatePatch(added, p, "", "new\n");
    const deleted = { ...file, status: "deleted" as const };
    validatePatch(
      deleted,
      header.replace("+++ b/a.txt", "+++ /dev/null") + "@@ -1 +0,0 @@\n-old\n",
      "old\n",
      "",
    );
    expect(textRevisions(snapshot.basis, added).old).toEqual({ kind: "absent" });
    expect(textRevisions(snapshot.basis, deleted).new).toEqual({ kind: "absent" });
  });
  it("checks rename paths and keeps current empty files distinct from absence", () => {
    const renamed = { ...file, previousPath: "old.txt", status: "renamed" as const };
    const p = patch
      .replaceAll("a/a.txt", "a/old.txt")
      .replace(
        "--- a/old.txt",
        "similarity index 80%\nrename from old.txt\nrename to a.txt\n--- a/old.txt",
      );
    validatePatch(renamed, p, oldText, newText);
    expect(textRevisions(snapshot.basis, renamed).old).toEqual({
      kind: "commit",
      path: "old.txt",
      sha: "b".repeat(40),
      side: "new",
    });
    expect(rejected(() => validatePatch(renamed, patch, oldText, newText))).toBe(STALE);
    expect(rejected(() => validateContext(snapshot, { ...pair(), old: { kind: "absent" } }))).toBe(
      STALE,
    );
    expect(
      validateContext({ ...snapshot, patch: header + "@@ -0,0 +1 @@\n+new\n" }, pair("", "new\n")),
    ).toEqual({ old: "", new: "new\n" });
  });
  it("validates response paths, revisions, actual UTF-8 bytes and limits without truncation", () => {
    expect(
      rejected(() =>
        validateContext(snapshot, {
          ...pair(),
          new: { ...pair().new, revision: { kind: "working_tree", path: "wrong" } },
        }),
      ),
    ).toBe(STALE);
    expect(
      rejected(() =>
        validateContext(snapshot, { ...pair(), old: { ...pair().old, sizeBytes: 0 } }),
      ),
    ).toBe("Context is not valid UTF-8 text.");
    expect(rejected(() => validateText("é", 1))).toBe("Context is not valid UTF-8 text.");
    expect(rejected(() => validateText("\ud800", 3))).toBe("Context is not valid UTF-8 text.");
    expect(rejected(() => validateText("\0", 1))).toBe("Context is not valid UTF-8 text.");
    expect(rejected(() => validateText("x".repeat(1024 * 1024 + 1), 0))).toBe(
      "Context exceeds the 1 MiB or 20,000 line limit.",
    );
    expect(rejected(() => validateText("x\n".repeat(20_001), 40_002))).toBe(
      "Context exceeds the 1 MiB or 20,000 line limit.",
    );
    expect(validateContext(snapshot, pair())).toEqual({ old: oldText, new: newText });
  });
});
