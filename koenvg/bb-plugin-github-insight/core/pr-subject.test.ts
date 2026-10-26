import { describe, expect, it } from "vitest";
import { isPrSubject, parsePrSubject, prSubjectId } from "./pr-subject";

describe("PR subject ids", () => {
  it("round-trips a PR", () => {
    const ref = { owner: "acme", repo: "api.js", number: 15 };

    expect(prSubjectId(ref)).toBe("pr:acme/api.js#15");
    expect(parsePrSubject(prSubjectId(ref))).toEqual(ref);
  });

  it.each(["thr_1", "pr:acme/api", "pr:acme/api#0", "pr:a/b/c#1"])("rejects %s", (id) => {
    expect(parsePrSubject(id)).toBeNull();
  });

  it("tells a PR subject from a thread id", () => {
    expect(isPrSubject("pr:acme/api#1")).toBe(true);
    expect(isPrSubject("thr_1")).toBe(false);
  });
});
