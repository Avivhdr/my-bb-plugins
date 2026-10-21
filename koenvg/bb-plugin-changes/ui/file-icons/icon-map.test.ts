import { describe, expect, it } from "vitest";
import { getFileIconName } from "./icon-map";

describe("getFileIconName", () => {
  it.each([
    ["src/a.ts", "typescript"],
    ["a.tsx", "react_ts"],
    ["package.json", "nodejs"],
    ["docs/README.md", "readme"],
    ["types/x.d.ts", "typescript-def"],
    [".env.local", "tune"],
    ["notes.xyz", "file"],
    ["Makefile", "file"],
  ])("maps %s to %s", (path, icon) => {
    expect(getFileIconName(path)).toBe(icon);
  });
});
