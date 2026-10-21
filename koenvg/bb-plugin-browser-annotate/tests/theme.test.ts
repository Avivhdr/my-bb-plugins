import { afterEach, describe, expect, it } from "vitest";
import { readHostTheme } from "../lib/theme";

afterEach(() => document.documentElement.removeAttribute("style"));

describe("readHostTheme", () => {
  it("reads BB tokens and falls back to the next token", () => {
    const root = document.documentElement;
    root.style.setProperty("--background", "#0b0b0c");
    root.style.setProperty("--foreground", "#f4f4f5");
    root.style.setProperty("--primary", "oklch(27% 0 0)");

    const theme = readHostTheme();

    expect(theme).toMatchObject({
      surface: "#0b0b0c",
      text: "#f4f4f5",
      accent: "oklch(27% 0 0)",
      ring: "oklch(27% 0 0)",
      danger: "",
    });
  });
});
