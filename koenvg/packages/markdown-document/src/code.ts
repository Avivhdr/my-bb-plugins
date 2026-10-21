import { refractor } from "refractor/core";
import markup from "refractor/markup";
import css from "refractor/css";
import javascript from "refractor/javascript";
import typescript from "refractor/typescript";
import json from "refractor/json";
import bash from "refractor/bash";
import python from "refractor/python";
import { visit } from "unist-util-visit";
import type { ElementContent, Root } from "hast";

for (const grammar of [markup, css, javascript, typescript, json, bash, python])
  refractor.register(grammar);

const languages: Readonly<Record<string, string>> = {
  markup: "markup",
  html: "markup",
  xml: "markup",
  css: "css",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  json: "json",
  bash: "bash",
  sh: "bash",
  shell: "bash",
  python: "python",
  py: "python",
};
const encoder = new TextEncoder();
const MAX_CODE_BYTES = 20 * 1024;
const MAX_TOKEN_NODES = 16_384;
const MAX_TOKEN_DEPTH = 64;
type PassiveTokens = Readonly<{ nodes: ElementContent[]; text: string }>;

function passiveTokens(input: unknown): PassiveTokens {
  let remaining = MAX_TOKEN_NODES;
  function parse(nodes: unknown, depth: number): PassiveTokens {
    if (!Array.isArray(nodes) || depth > MAX_TOKEN_DEPTH) throw new Error("Invalid token tree");
    let text = "";
    const safe: ElementContent[] = [];
    for (const node of nodes) {
      if (--remaining < 0 || !node || typeof node !== "object") throw new Error("Invalid token");
      if (node.type === "text" && typeof node.value === "string") {
        text += node.value;
        safe.push({ type: "text", value: node.value });
      } else if (node.type === "element" && node.tagName === "span") {
        const children = parse(node.children, depth + 1);
        const classes: unknown = node.properties?.className;
        safe.push({
          type: "element",
          tagName: "span",
          properties: {
            className: Array.isArray(classes)
              ? classes.filter((value) => typeof value === "string" && /^[a-z-]+$/.test(value))
              : [],
          },
          children: children.nodes,
        });
        text += children.text;
      } else {
        throw new Error("Unexpected syntax node");
      }
    }
    return { nodes: safe, text };
  }
  return parse(input, 0);
}

export function boundedCode() {
  return (tree: Root) => {
    visit(tree, "element", (node) => {
      if (node.tagName !== "pre" || node.children.length !== 1) return;
      const code = node.children[0];
      if (code?.type !== "element" || code.tagName !== "code" || code.children.length !== 1) return;
      const value = code.children[0];
      if (value?.type !== "text") return;
      const classes = code.properties.className;
      const label = Array.isArray(classes)
        ? classes.find((c) => typeof c === "string" && c.startsWith("language-"))
        : null;
      const name = typeof label === "string" ? label.slice(9).toLowerCase() : "";
      const language = Object.hasOwn(languages, name) ? languages[name] : undefined;
      if (!language || encoder.encode(value.value).byteLength > MAX_CODE_BYTES) return;
      try {
        const tokens = passiveTokens(refractor.highlight(value.value, language).children);
        if (tokens.text === value.value) code.children = tokens.nodes;
      } catch {
        return;
      }
    });
  };
}
