// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { createDocumentModel, MarkdownDocument } from "@bb-plugins/markdown-document";
import { refractor } from "refractor/core";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function documentCode(code: string, language = "json") {
  const source = `\`\`\`${language}\n${code}\`\`\`\n`;
  const model = createDocumentModel(source, "code-reader");
  const ui = render(<MarkdownDocument model={model} view="preview" />);
  return { block: ui.container.querySelector("pre code")!, model, source };
}
describe("rendered fenced code", () => {
  it("highlights explicitly selected JSON without reformatting compact source", () => {
    const code = '{"compact":true,"value":"<script>bad()</script>"}  \n';
    const { block, model, source } = documentCode(code);
    expect(block.querySelector(".token.string")).not.toBeNull();
    expect(block.textContent).toBe(code);
    expect(block.querySelector("script")).toBeNull();
    expect(model.sourceLines.lines.join("")).toBe(source);
  });
  it.each(["", "unknown", "constructor", "toString", "json5"])(
    "keeps missing or unknown language %j plain without tokenizing",
    (language) => {
      const tokenize = vi.spyOn(refractor, "highlight");
      const { block } = documentCode('  {"value":true}\t \n\n', language);
      expect(block.textContent).toBe('  {"value":true}\t \n\n');
      expect(block.querySelector("span")).toBeNull();
      expect(tokenize).not.toHaveBeenCalled();
    },
  );
  it.each([
    ["javascript", "const value = true;\n"],
    ["js", "const value = true;\n"],
    ["typescript", "const value: number = 1;\n"],
    ["ts", "const value: number = 1;\n"],
    ["json", '{"value":true}\n'],
    ["JSON", '{"value":true}\n'],
    ["bash", 'echo "$HOME"\n'],
    ["sh", 'echo "$HOME"\n'],
    ["shell", 'echo "$HOME"\n'],
    ["python", "print(True)\n"],
    ["py", "print(True)\n"],
    ["markup", '<div title="safe">text</div>\n'],
    ["html", '<div title="safe">text</div>\n'],
    ["xml", '<node title="safe" />\n'],
    ["css", "body { color: red; }\n"],
  ])("renders bundled language or alias %s as passive exact code", (language, code) => {
    const { block } = documentCode(code, language);
    expect(block.querySelector(".token")).not.toBeNull();
    expect(block.textContent).toBe(code);
    expect(block.querySelectorAll("div, node, script, style, a, img")).toHaveLength(0);
  });
  it.each([20480, 20481])(
    "uses the inclusive 20 KiB boundary before tokenization: %i UTF-8 bytes",
    (bytes) => {
      const tokenize = vi.spyOn(refractor, "highlight");
      const code = "const x = 1;" + " ".repeat(bytes - 13) + "\n";
      const { block, model, source } = documentCode(code, "js");
      expect(block.textContent).toBe(code);
      expect(model.sourceLines.lines.join("")).toBe(source);
      expect(!!block.querySelector(".token")).toBe(bytes === 20480);
      expect(tokenize).toHaveBeenCalledTimes(bytes === 20480 ? 1 : 0);
    },
  );
  it.each([10238, 10239])(
    "guards UTF-8 bytes, not UTF-16 length, for %i multibyte characters",
    (count) => {
      const tokenize = vi.spyOn(refractor, "highlight");
      const code = "// " + "é".repeat(count) + "\n";
      const { block } = documentCode(code, "js");
      expect(block.textContent).toBe(code);
      expect(!!block.querySelector(".token")).toBe(count === 10238);
      expect(tokenize).toHaveBeenCalledTimes(count === 10238 ? 1 : 0);
    },
  );
  it("keeps multiline JSON, tabs, blank lines and trailing spaces without parsing or formatting", () => {
    const code = '{\n\t"value": "é",  \n\n  "nested": [true, null]\n}\n';
    const { block, model, source } = documentCode(code);
    expect(block.querySelector(".token")).not.toBeNull();
    expect(block.textContent).toBe(code);
    expect(model.sourceLines.lines.join("")).toBe(source);
  });
  it("does not tokenize inline code or an indented block without a language", () => {
    const tokenize = vi.spyOn(refractor, "highlight");
    const model = createDocumentModel("`const x = true;`\n\n    const y = true;\n", "unlabelled");
    const ui = render(<MarkdownDocument model={model} view="preview" />);
    expect(ui.container.querySelectorAll("code")).toHaveLength(2);
    expect(ui.container.querySelector(".token")).toBeNull();
    expect(tokenize).not.toHaveBeenCalled();
  });
  it("keeps the document readable when the external tokenizer fails", () => {
    vi.spyOn(refractor, "highlight").mockImplementation(() => {
      throw new Error("Tokenizer failed");
    });
    const { block, model, source } = documentCode('{"value":true}  \n');
    expect(block.textContent).toBe('{"value":true}  \n');
    expect(block.querySelector("span")).toBeNull();
    expect(model.sourceLines.lines.join("")).toBe(source);
  });
  it("falls back if a tokenizer result changes text or contains active nodes", () => {
    const tokenize = vi.spyOn(refractor, "highlight");
    for (const tree of [
      { type: "root" as const, children: [{ type: "text" as const, value: "changed" }] },
      {
        type: "root" as const,
        children: [
          {
            type: "element" as const,
            tagName: "script",
            properties: {},
            children: [{ type: "text" as const, value: "bad()" }],
          },
        ],
      },
    ]) {
      tokenize.mockReturnValueOnce(tree);
      const { block } = documentCode('{"value":true}\n');
      expect(block.textContent).toBe('{"value":true}\n');
      expect(block.querySelector("span, script")).toBeNull();
    }
  });
  it("preserves parser-rendered text at an unclosed EOF fence and exact original Raw", () => {
    const source = '```json\r\n{"value":true}  ';
    const model = createDocumentModel(source, "eof-code");
    const ui = render(<MarkdownDocument model={model} view="preview" />);
    const block = ui.container.querySelector("pre code")!;
    expect(block.textContent).toBe('{"value":true}  \n');
    expect(block.querySelector(".token")).not.toBeNull();
    expect(model.sourceLines.lines.join("")).toBe(source);
  });
});
