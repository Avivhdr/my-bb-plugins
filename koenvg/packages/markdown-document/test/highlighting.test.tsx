// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { refractor } from "refractor/core";
import { MarkdownDocument, createDocumentModel } from "@bb-plugins/markdown-document";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fence(label: string, body: string, closed = true) {
  return render(
    <MarkdownDocument
      model={createDocumentModel(`\`\`\`${label}\n${body}${closed ? "\n```" : ""}`, "highlight")}
      view="preview"
    />,
  ).container.querySelector("pre code")!;
}

describe("public fence highlighting", () => {
  it.each([
    ["json", '{"status":"fulfilled","count":42,"ready":true,"empty":null}', "property", '"status"'],
    ["javascript", 'const value = "fulfilled";', "keyword", "const"],
    ["js", 'const value = "fulfilled";', "keyword", "const"],
    ["typescript", "const value: boolean = true;", "keyword", "const"],
    ["ts", "const value: boolean = true;", "keyword", "const"],
    ["bash", 'echo "$HOME"', "builtin", "echo"],
    ["sh", 'echo "$HOME"', "builtin", "echo"],
    ["shell", 'echo "$HOME"', "builtin", "echo"],
    ["python", "def report(): return True", "keyword", "def"],
    ["py", "def report(): return True", "keyword", "def"],
    ["markup", '<p class="report">text</p>', "tag", '<p class="report">'],
    ["html", '<p class="report">text</p>', "tag", '<p class="report">'],
    ["xml", '<p class="report">text</p>', "tag", '<p class="report">'],
    ["css", "p { color: red; }", "property", "color"],
    ["JS", 'const value = "fulfilled";', "keyword", "const"],
  ])("highlights explicit %s without changing text", (label, body, token, expected) => {
    const code = fence(label, body);
    expect(code.textContent).toBe(body + "\n");
    expect(code.querySelector(`.token.${token}`)?.textContent).toBe(expected);
    expect(Array.from(code.querySelectorAll("*")).every((node) => node.tagName === "SPAN")).toBe(
      true,
    );
  });

  it.each(["unknown", "", "toString", "__proto__"])("leaves %s plain", (label) => {
    const code = fence(label, 'const value = "fulfilled";');
    expect(code.textContent).toBe('const value = "fulfilled";\n');
    expect(code.querySelectorAll("span")).toHaveLength(0);
  });

  it.each([
    [20480, false],
    [20481, false],
    [20480, true],
    [20481, true],
  ])("bounds %i rendered UTF-8 bytes, multibyte %s", (bytes, multibyte) => {
    const prefix = 'const value = "';
    const suffix = '";\n';
    const count = bytes - prefix.length - suffix.length;
    const payload = multibyte
      ? "é".repeat(Math.floor(count / 2)) + "x".repeat(count % 2)
      : "x".repeat(count);
    const expected = prefix + payload + suffix;
    const spy = vi.spyOn(refractor, "highlight");
    const code = fence("js", expected.slice(0, -1));
    expect(new TextEncoder().encode(code.textContent!).byteLength).toBe(bytes);
    expect(code.textContent).toBe(expected);
    if (bytes === 20480) {
      expect(code.querySelector(".token.keyword")?.textContent).toBe("const");
      expect(spy).toHaveBeenCalledOnce();
    } else {
      expect(code.querySelectorAll("span")).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("preserves tabs, trailing spaces, literal JSON values and inline code", () => {
    const body =
      '\t{ "status": "fulfilled", "result": "inconclusive", "ok": true, "n": 12, "empty": null }  ';
    const code = fence("json", body);
    expect(code.textContent).toBe(body + "\n");
    expect(
      Array.from(code.querySelectorAll(".token.string")).map((node) => node.textContent),
    ).toEqual(['"fulfilled"', '"inconclusive"']);
    expect(code.querySelector(".token.boolean")?.textContent).toBe("true");
    expect(code.querySelector(".token.number")?.textContent).toBe("12");
    expect(code.querySelector(".token.null")?.textContent).toBe("null");
    const { container } = render(
      <MarkdownDocument
        model={createDocumentModel("Inline `const x = true`.", "inline")}
        view="preview"
      />,
    );
    expect(container.querySelector("p")?.textContent).toBe("Inline const x = true.");
    expect(container.querySelectorAll("code span")).toHaveLength(0);
  });

  it("renders empty and unclosed fences with parser newline semantics", () => {
    expect(fence("js", "").textContent).toBe("");
    const code = fence("js", "\tconst x = true;  ", false);
    expect(code.textContent).toBe("\tconst x = true;  \n");
    expect(code.querySelector(".token.keyword")?.textContent).toBe("const");
  });

  it("keeps exact BOM/CRLF source in Raw even after highlighting", () => {
    const text = '\uFEFF```json\r\n\t{"ok":true}  \r\n```\r\n';
    const model = createDocumentModel(text, "raw");
    const { container, rerender } = render(<MarkdownDocument model={model} view="preview" />);
    expect(container.querySelector("code")?.textContent).toBe('\t{"ok":true}  \n');
    expect(container.querySelector(".token.boolean")?.textContent).toBe("true");
    rerender(<MarkdownDocument model={model} view="raw" />);
    expect(container.querySelector("pre")?.textContent).toBe(text);
  });

  it("reconstructs passive spans without tokenizer attributes or unsafe classes", () => {
    vi.spyOn(refractor, "highlight").mockImplementation((text) => ({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "span",
          properties: {
            className: ["token", "keyword", "bad class", "onload=run()"],
            style: "color:red",
            onClick: "run()",
            id: "outside",
          },
          children: [{ type: "text", value: text }],
        },
      ],
    }));
    const code = fence("js", "const safe = true;");
    expect(code.textContent).toBe("const safe = true;\n");
    expect(code.innerHTML).toBe('<span class="token keyword">const safe = true;\n</span>');
  });

  it.each(["throws", "active", "lossy", "invalid", "deep", "many"])(
    "falls back when tokenizer output is %s",
    (failure) => {
      const original = refractor.highlight.bind(refractor);
      vi.spyOn(refractor, "highlight").mockImplementation((text, language) => {
        if (text.startsWith("const good")) return original(text, language);
        if (failure === "throws") throw new Error("fixture failure");
        let children: unknown = [{ type: "text", value: failure === "lossy" ? "changed" : text }];
        if (failure === "active")
          children = [{ type: "element", tagName: "script", properties: {}, children }];
        if (failure === "invalid") children = [{ type: "text", value: 42 }];
        if (failure === "deep")
          for (let i = 0; i < 66; i++)
            children = [{ type: "element", tagName: "span", properties: {}, children }];
        if (failure === "many")
          children = [
            {
              type: "element",
              tagName: "span",
              properties: { className: ["token", "keyword"] },
              children: [{ type: "text", value: text }],
            },
            ...Array.from({ length: 16384 }, () => ({ type: "text", value: "" })),
          ];
        return { type: "root", children } as ReturnType<typeof refractor.highlight>;
      });
      const { container } = render(
        <MarkdownDocument
          model={createDocumentModel(
            "```js\nconst bad = true;\n```\n\n```js\nconst good = true;\n```",
            "failure",
          )}
          view="preview"
        />,
      );
      const [bad, good] = Array.from(container.querySelectorAll("pre code"));
      expect(bad!.textContent).toBe("const bad = true;\n");
      expect(bad!.querySelectorAll("span")).toHaveLength(0);
      expect(good!.textContent).toBe("const good = true;\n");
      expect(good!.querySelector(".token.keyword")?.textContent).toBe("const");
    },
  );
});
