import { describe, expect, it } from "vitest";
import { parsePageMessage } from "../lib/page/messages";

const save = {
  type: "save",
  url: "https://example.com/a",
  kind: "button",
  comment: "Too much padding",
  rect: { x: 10, y: 20, width: 100, height: 40 },
  scroll: { x: 0, y: 300 },
  isFixed: false,
  viewport: { width: 1440, height: 900 },
};

describe("parsePageMessage", () => {
  it("accepts every message type", () => {
    expect(parsePageMessage(save)).toEqual(save);
    expect(parsePageMessage({ type: "update", id: "a", comment: "x" })).toEqual({
      type: "update",
      id: "a",
      comment: "x",
    });
    expect(parsePageMessage({ type: "delete", id: "a" })).toEqual({ type: "delete", id: "a" });
    expect(parsePageMessage({ type: "mode", on: false })).toEqual({ type: "mode", on: false });
  });

  it.each([
    ["an unknown type", { type: "navigate", url: "https://evil.example" }],
    ["a non-object", "save"],
    ["a missing rect", { ...save, rect: undefined }],
    ["a string size", { ...save, rect: { ...save.rect, width: "100" } }],
    ["a blank comment", { ...save, comment: "  " }],
    ["a kind with markup", { ...save, kind: "x onerror=alert(1)" }],
    ["a rect outside the viewport", { ...save, rect: { x: 2000, y: 20, width: 100, height: 40 } }],
    ["an empty rect", { ...save, rect: { x: 10, y: 20, width: 0, height: 40 } }],
  ])("rejects %s", (_name, data) => {
    expect(parsePageMessage(data)).toBeNull();
  });

  it("clamps a rect that extends past the viewport", () => {
    const parsed = parsePageMessage({ ...save, rect: { x: -20, y: 880, width: 100, height: 40 } });

    expect(parsed).toMatchObject({ rect: { x: 0, y: 880, width: 80, height: 20 } });
  });
});
