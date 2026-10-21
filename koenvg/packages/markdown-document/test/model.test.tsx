// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import {
  createDocumentModel,
  MarkdownDocument,
  localDestinations,
} from "@bb-plugins/markdown-document";

afterEach(cleanup);
describe("document navigation model", () => {
  it("hides leading YAML metadata without changing source lines or body navigation", () => {
    const text = [
      "---",
      "name: BB plugins",
      "description: Plugin UI that reads as part of BB.",
      "colors:",
      '  canvas: "oklch(100% 0 0)"',
      'image: "![Metadata](hidden.png)"',
      "---",
      "",
      "# BB plugins",
      "",
      "Body text. [Jump](#details)",
      "",
      "Details",
      "---",
      "",
    ].join("\n");
    const model = createDocumentModel(text, "frontmatter");
    const ui = render(
      <MarkdownDocument model={model} view="preview" destinations={localDestinations} />,
    );
    expect(ui.container.textContent).not.toContain("name:");
    expect(ui.container.textContent).not.toContain("oklch");
    expect(ui.container.textContent).toContain("Body text.");
    expect(
      within(ui.container)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(["BB plugins", "Details"]);
    expect(model.headings.map((h) => [h.level, h.text, h.line])).toEqual([
      [1, "BB plugins", 9],
      [2, "Details", 13],
    ]);
    expect(model.fragmentTarget("#details")).toBe(model.headings[1]!.id);
    expect(ui.container.querySelector("a")?.getAttribute("data-heading-target")).toBe(
      model.headings[1]!.id,
    );
    expect(model.requests).toEqual([]);
    expect(model.sourceLines.lines.join("")).toBe(text);
  });
  it.each(["\n", "\r\n", "\r"])(
    "hides YAML after a BOM with %j line endings and keeps original heading lines",
    (newline) => {
      const text = "\ufeff" + ["---", "title: é", "---", "# 日本語", ""].join(newline);
      const model = createDocumentModel(text, "bom-frontmatter");
      const ui = render(
        <MarkdownDocument model={model} view="preview" destinations={localDestinations} />,
      );
      expect(ui.container.textContent).not.toContain("title:");
      expect(
        within(ui.container)
          .getAllByRole("heading")
          .map((h) => h.textContent),
      ).toEqual(["日本語"]);
      expect(model.headings.map((h) => [h.text, h.line])).toEqual([["日本語", 4]]);
      expect(model.sourceLines.lines.join("")).toBe(text);
    },
  );
  it("does not create preview content or headings for a metadata-only document", () => {
    const model = createDocumentModel("---\ntitle: Metadata only\n---\n", "metadata-only");
    const ui = render(
      <MarkdownDocument model={model} view="preview" destinations={localDestinations} />,
    );
    expect(ui.container.textContent).toBe("");
    expect(model.headings).toEqual([]);
  });
  it.each([
    ["---\nUnclosed header\n\n# Body\n", ["Body"], 1],
    ["# Body\n\n---\nOrdinary section\n---\n", ["Body", "Ordinary section"], 1],
  ])("keeps ordinary separators and unclosed headers visible in %j", (text, labels, rules) => {
    const model = createDocumentModel(text, "ordinary-markdown");
    const ui = render(
      <MarkdownDocument model={model} view="preview" destinations={localDestinations} />,
    );
    expect(
      within(ui.container)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(labels);
    expect(ui.container.querySelectorAll("hr")).toHaveLength(rules);
    if (text.includes("Unclosed")) expect(ui.container.textContent).toContain("Unclosed header");
  });
  it("derives levels, labels and distinct conventional targets from the rendered Markdown parse", () => {
    const text =
      "# **Hello** `code` [link](next.md)\n\n## 日本語 café\n\n## 日本語 café\n\n### 日本語 café-1\n\nSetext *title*\n----\n\n> #### Quoted\n\n```md\n# Not a heading\n```\n\n<div><h1>Not rendered</h1></div>\n";
    const model = createDocumentModel(text, "reader-one");
    expect(model.headings.map((h) => [h.level, h.text, h.fragment, h.line])).toEqual([
      [1, "Hello code link", "hello-code-link", 1],
      [2, "日本語 café", "日本語-café", 3],
      [2, "日本語 café", "日本語-café-1", 5],
      [3, "日本語 café-1", "日本語-café-1-1", 7],
      [2, "Setext title", "setext-title", 9],
      [4, "Quoted", "quoted", 12],
    ]);
    const ui = render(
      <MarkdownDocument model={model} view="preview" destinations={localDestinations} />,
    );
    const headings = within(ui.container).getAllByRole("heading");
    expect(headings.map((h) => h.id)).toEqual(model.headings.map((h) => h.id));
    expect(headings.map((h) => h.textContent)).toEqual(model.headings.map((h) => h.text));
    expect(model.fragmentTarget("#%E6%97%A5%E6%9C%AC%E8%AA%9E-caf%C3%A9-1")).toBe(
      model.headings[2]!.id,
    );
    expect(model.fragmentTarget("#missing")).toBeNull();
    expect(model.fragmentTarget("#%zz")).toBeNull();
    expect(model.fragmentTarget("next.md#quoted")).toBeNull();
  });
  it("keeps real source lines and exact text while normalizing inclusive requests safely", () => {
    const source =
      "\ufeff---\r\ntitle: é\r\n---\r\n# 日本語\r\n```text\r\n  long " +
      "x".repeat(300) +
      "  \r\n```\r\n";
    const model = createDocumentModel(source, "raw-reader");
    expect(model.sourceLines.lines).toHaveLength(8);
    expect(model.sourceLines.lines.join("")).toBe(source);
    expect(model.sourceLines.lines[5]).toBe("  long " + "x".repeat(300) + "  \r\n");
    expect(model.sourceLines.target({ startLineNumber: 6, endLineNumber: 5 })).toEqual({
      start: 5,
      end: 6,
    });
    expect(model.sourceLines.target({ startLineNumber: -5, endLineNumber: 1000 })).toEqual({
      start: 1,
      end: 8,
    });
    expect(model.sourceLines.target({ startLineNumber: 100, endLineNumber: 101 })).toEqual({
      start: 8,
      end: 8,
    });
    for (const request of [
      null,
      {},
      "3",
      { startLineNumber: 1.5, endLineNumber: 2 },
      { startLineNumber: NaN, endLineNumber: 2 },
      { startLineNumber: 1, endLineNumber: Infinity },
      { startLineNumber: "1", endLineNumber: 2 },
    ]) {
      expect(model.sourceLines.target(request)).toBeNull();
    }
    expect(
      createDocumentModel("", "empty").sourceLines.target({ startLineNumber: 1, endLineNumber: 2 }),
    ).toBeNull();
    expect(createDocumentModel("a\rb\nc", "mixed").sourceLines.lines).toEqual(["a\r", "b\n", "c"]);
  });
  it("keeps all six levels, image alt text, entities and slug collisions aligned with visible headings", () => {
    const model = createDocumentModel(
      "# Foo\n\n## Foo-1\n\n### Foo\n\n#### ![Alt](diagram.png) *Bold* ~~gone~~ &amp; `x`\n\n##### Level five\n\n###### Level six\n\n#\n",
      "levels",
    );
    expect(model.headings.map((h) => h.fragment)).toEqual([
      "foo",
      "foo-1",
      "foo-2",
      "alt-bold-gone-x",
      "level-five",
      "level-six",
      "section",
    ]);
    expect(model.fragmentTarget("#alt-bold-gone--x")).toBe(model.headings[3]!.id);
    expect(model.fragmentTarget("#")).toBe(model.headings[6]!.id);
    expect(model.headings.map((h) => h.level)).toEqual([1, 2, 3, 4, 5, 6, 1]);
    const ui = render(
      <MarkdownDocument model={model} view="preview" destinations={localDestinations} />,
    );
    expect(
      within(ui.container)
        .getAllByRole("heading")
        .map((h) => h.textContent),
    ).toEqual(model.headings.map((h) => h.text));
    expect(ui.container.querySelector("img")).toBeNull();
    expect(model.fragmentTarget("#foo-2")).toBe(model.headings[2]!.id);
  });
  it.each(["", "# Actual\r\n\r\n"])(
    "keeps used footnotes reader-local and does not invent source headings for prefix %j",
    (prefix) => {
      const text = prefix + "Text[^1] and repeated[^1]\r\n\r\n[^1]: Note é.\r\n";
      const first = createDocumentModel(text, "footnotes-one");
      const second = createDocumentModel(text, "footnotes-two");
      expect(first.headings.map((h) => [h.text, h.line])).toEqual(prefix ? [["Actual", 1]] : []);
      expect(first.fragmentTarget("#footnotes")).toBeNull();
      expect(first.sourceLines.lines.join("")).toBe(text);
      const ui = render(
        <>
          <article data-reader="first">
            <MarkdownDocument model={first} view="preview" destinations={localDestinations} />
          </article>
          <article data-reader="second">
            <MarkdownDocument model={second} view="preview" destinations={localDestinations} />
          </article>
        </>,
      );
      const ids = Array.from(ui.container.querySelectorAll("[id]"), (e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const reader of Array.from(ui.container.querySelectorAll("article[data-reader]"))) {
        expect(reader.textContent).toContain("Note é.");
        expect(reader.querySelectorAll("a[href]")).toHaveLength(4);
        for (const anchor of Array.from(reader.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
          expect(
            Array.from(reader.querySelectorAll("[id]")).some(
              (e) => `#${e.id}` === anchor.getAttribute("href"),
            ),
          ).toBe(true);
        }
        const references = reader.querySelectorAll("sup [aria-describedby]");
        expect(references).toHaveLength(2);
        for (const reference of Array.from(references)) {
          const labelId = reference.getAttribute("aria-describedby");
          const label = Array.from(reader.querySelectorAll("[id]")).find((e) => e.id === labelId);
          expect(label?.textContent).toBe("Footnotes");
        }
      }
    },
  );
});
