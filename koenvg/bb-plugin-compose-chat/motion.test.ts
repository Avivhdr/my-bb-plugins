import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import postcss from "postcss";

const css = readFileSync(new URL("./motion.css", import.meta.url), "utf8");
const root = postcss.parse(css);

describe("Native working-state lattice", () => {
  it("scopes effects to inline activity titles, not the composer status or other shimmers", () => {
    root.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && rule.parent.name === "keyframes") return;
      expect(rule.selector).toMatch(/^:root\[data-compose-chat/);
      if (rule.selector.includes("animate-shine")) {
        expect(rule.selector).toMatch(/\[data-timeline-row-list\]\s+\[data-timeline-row-id\]/);
        expect(rule.selector).toMatch(/\.leading-5\s*>\s*\.animate-shine/);
        expect(rule.selector).not.toContain("~ div");
      }
    });
    expect(css).not.toMatch(/#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
  });

  it("removes BB's animated image mask and releases its compositor hint", () => {
    const labelRule = root.nodes.find(
      (node) => node.type === "rule" && node.selector.endsWith("> .animate-shine"),
    );
    expect(labelRule?.type).toBe("rule");
    if (labelRule?.type !== "rule") return;
    const declarations = new Map(
      labelRule.nodes.filter((node) => node.type === "decl").map((node) => [node.prop, node.value]),
    );
    expect(declarations.get("mask-image")).toBe("none");
    expect(declarations.get("-webkit-mask-image")).toBe("none");
    expect(declarations.get("will-change")).toBe("auto");
  });

  it("paints the top-left dot with its own fill in every animation phase", () => {
    const dotRule = root.nodes.find(
      (node) => node.type === "rule" && node.selector.endsWith(".animate-shine::before"),
    );
    expect(dotRule?.type).toBe("rule");
    if (dotRule?.type !== "rule") return;
    expect(
      dotRule.nodes.some(
        (node) =>
          node.type === "decl" &&
          node.prop === "background-color" &&
          node.value === "var(--compose-lattice-idle)",
      ),
    ).toBe(true);
    root.walkAtRules("keyframes", (keyframes) => {
      keyframes.walkRules((frame) => {
        const shadow = frame.nodes.find(
          (node) => node.type === "decl" && node.prop === "box-shadow",
        );
        const fill = frame.nodes.find(
          (node) => node.type === "decl" && node.prop === "background-color",
        );
        expect(shadow?.type).toBe("decl");
        expect(fill?.type).toBe("decl");
        if (shadow?.type === "decl" && fill?.type === "decl") {
          expect(fill.value).toBe(shadow.value.split(",")[0].trim().replace(/^0 0 /, ""));
        }
      });
    });
  });

  it("replaces the native activity glyph rather than adding a second icon column", () => {
    const iconRule = root.nodes.find(
      (node) =>
        node.type === "rule" &&
        node.selector
          .replace(/\s+/g, " ")
          .endsWith("span:has(> .leading-5 > .animate-shine) > [data-icon-root]"),
    );
    expect(iconRule?.type).toBe("rule");
    if (iconRule?.type !== "rule") return;
    expect(
      iconRule.nodes.some(
        (node) => node.type === "decl" && node.prop === "display" && node.value === "none",
      ),
    ).toBe(true);
  });
  it("sweeps nine dots in the reference's right-pointing arrow groups", () => {
    const frames: string[] = [];
    // Row-major phase map from the Arrow reference: [1,2,3, 0,1,2, 1,2,3].
    const groups = [
      ["0 6px"],
      ["0 0", "6px 6px", "0 12px"],
      ["6px 0", "12px 6px", "6px 12px"],
      ["12px 0", "12px 12px"],
    ];
    root.walkAtRules("keyframes", (rule) => {
      expect(rule.params).toBe("compose-lattice-arrow");
      rule.walkDecls("box-shadow", (decl) => {
        const dots = decl.value.split(",").map((value) => value.trim());
        expect(dots).toHaveLength(9);
        const head = dots.filter((value) => value.endsWith("var(--compose-lattice-head)"));
        if (head.length) frames.push(head.map((value) => value.split(" var(")[0]).join(","));
      });
    });
    expect(frames).toEqual(groups.map((group) => group.join(",")));
    expect(css).toContain("animation: compose-lattice-arrow 648ms linear infinite");
    expect(css).toContain('content: ""');
    expect(css).toContain("border-radius: 50%");
    expect(css).not.toMatch(/content:\s*["'](?:Working|Thinking)/);
  });

  it("has static reduced-motion and paused hidden-document alternatives", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain('data-compose-chat-motion="paused"');
    expect(css).toContain("animation-play-state: inherit");
    const reduced = root.nodes.find(
      (node) => node.type === "atrule" && node.params === "(prefers-reduced-motion: reduce)",
    );
    expect(reduced?.type).toBe("atrule");
    if (reduced?.type === "atrule") {
      const values: string[] = [];
      reduced.walkDecls("animation", (decl) => {
        values.push(decl.value);
      });
      expect(values).toContain("none");
    }
  });
});
