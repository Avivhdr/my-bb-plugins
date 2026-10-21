import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";

const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
const root = postcss.parse(css);

describe("Scoped, theme-native styling", () => {
  it("gates every style rule on the active content-script marker", () => {
    const selectors: string[] = [];
    root.walkRules((rule) => {
      selectors.push(rule.selector);
    });
    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      for (const part of selector.split(/,(?![^()]*\))/)) {
        expect(part.trim()).toMatch(/^:root\[data-compose-chat(?:[=\]])/);
      }
    }
  });

  it("uses host colors and fonts without a decorative palette", () => {
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i);
    expect(css).not.toMatch(/font-family\s*:/);
    expect(css).not.toMatch(/gradient\(|@keyframes|animation\s*:/);
    expect(css).toContain("var(--canvas)");
    expect(css).toContain("var(--ink)");
  });

  it("does not force native hidden controls open or change input layout", () => {
    root.walkDecls((decl) => {
      expect([
        "display",
        "grid-template-columns",
        "position",
        "visibility",
        "opacity",
        "pointer-events",
        "height",
        "max-height",
      ]).not.toContain(decl.prop);
      expect(decl.important).toBeFalsy();
    });
    expect(css).toContain("data-promptbox-compact");
  });

  it("leaves native split-send sizing and corner geometry to BB", () => {
    const geometry = new Set(["min-inline-size", "min-block-size", "border-radius"]);
    root.walkRules((rule) => {
      if (
        !rule.selector.includes("[data-promptbox-action-row]") &&
        !rule.selector.includes("[data-promptbox-submit-action]")
      )
        return;
      if (rule.nodes.some((node) => node.type === "decl" && geometry.has(node.prop))) {
        expect(rule.selector).toContain(":not([data-promptbox-send-menu] *)");
      }
    });
  });

  it("uses a soft shared frame without a second input outline", () => {
    const formRule = root.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector ===
          ':root[data-compose-chat="active"] [data-app-composer] form[data-promptbox]',
    );
    expect(formRule?.type).toBe("rule");
    if (formRule?.type !== "rule") return;
    expect(
      formRule.nodes.some(
        (node) => node.type === "decl" && node.prop === "outline" && node.value === "none",
      ),
    ).toBe(true);
    expect(css).toContain("--compose-shadow-color:");
    expect(css).toContain("box-shadow: var(--compose-shadow)");
    root.walkRules((rule) => {
      if (!rule.selector.includes(":focus-within")) return;
      for (const node of rule.nodes) {
        if (node.type === "decl" && node.prop === "outline") expect(node.value).toBe("none");
      }
    });
  });
  it("indents only bundle children by the same column reserved for activity markers", () => {
    const bundleRule = root.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector === ':root[data-compose-chat="active"] [data-timeline-row-list="bundle"]',
    );
    expect(bundleRule?.type).toBe("rule");
    if (bundleRule?.type !== "rule") return;
    expect(
      bundleRule.nodes.some(
        (node) =>
          node.type === "decl" &&
          node.prop === "padding-inline-start" &&
          node.value === "var(--compose-activity-inset)",
      ),
    ).toBe(true);
    expect(css).toContain("--compose-activity-inset: 20px");
  });

  it("keeps keyboard focus, disabled controls, touch targets, and reduced motion explicit", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain(":focus-within");
    expect(css).toContain(":disabled");
    expect(css).toContain("pointer: coarse");
    expect(css).toContain("prefers-reduced-motion");
  });
});
