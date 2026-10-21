import { describe, expect, it } from "vitest";
import { isOtherPerson } from "./actor";
import { newCommentIds, postedAt } from "./new-comments";

const MARKED_AT = Date.parse("2026-10-01T10:00:00Z");

function comment(id: string, at: string) {
  return { id, postedAt: at };
}

describe("newCommentIds", () => {
  it("returns a comment posted after the mark", () => {
    expect(newCommentIds([comment("c1", "2026-10-01T11:00:00Z")], MARKED_AT, new Set())).toEqual([
      "c1",
    ]);
  });

  it("skips a comment posted before the mark", () => {
    expect(newCommentIds([comment("c1", "2026-10-01T09:00:00Z")], MARKED_AT, new Set())).toEqual(
      [],
    );
  });

  it("skips a seen comment", () => {
    expect(
      newCommentIds([comment("c1", "2026-10-01T11:00:00Z")], MARKED_AT, new Set(["c1"])),
    ).toEqual([]);
  });

  it("returns nothing without a mark", () => {
    expect(newCommentIds([comment("c1", "2026-10-01T11:00:00Z")], null, new Set())).toEqual([]);
  });
});

describe("postedAt", () => {
  it("takes the publish time of a comment from a pending review", () => {
    expect(
      postedAt({ createdAt: "2026-10-01T09:00:00Z", publishedAt: "2026-10-01T11:00:00Z" }),
    ).toBe("2026-10-01T11:00:00Z");
  });

  it("falls back to the create time", () => {
    expect(postedAt({ createdAt: "2026-10-01T09:00:00Z", publishedAt: null })).toBe(
      "2026-10-01T09:00:00Z",
    );
  });
});

describe("isOtherPerson", () => {
  it("accepts another user", () => {
    expect(isOtherPerson({ __typename: "User", login: "alice" }, "me")).toBe(true);
  });

  it.each([
    ["the viewer", { __typename: "User", login: "me" }],
    ["a bot", { __typename: "Bot", login: "renovate" }],
    ["a deleted user", null],
  ])("rejects %s", (_, actor) => {
    expect(isOtherPerson(actor, "me")).toBe(false);
  });
});
