// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  MarkdownDocument,
  createDocumentModel,
  denyDestinations,
  localDestinations,
  type DestinationPolicy,
} from "@bb-plugins/markdown-document";
import { readFileSync } from "node:fs";

afterEach(cleanup);
const fixture = readFileSync(`${process.cwd()}/test/fixtures/report.md`, "utf8");

describe("public document interface", () => {
  it("renders semantic GFM and exact code with explicit deny-all including footnotes", () => {
    const { container } = render(
      <MarkdownDocument
        model={createDocumentModel(fixture, "task-one")}
        view="preview"
        destinations={denyDestinations}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Report");
    expect(screen.getByRole("table").textContent).toBe("KeyValuefulfilledinconclusive");
    expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
    expect(container.querySelector("del")?.textContent).toBe("old");
    expect(container.querySelector("pre")?.textContent).toBe(
      '  const x = "fulfilled";\n\tline  \n',
    );
    expect(screen.getByText("chart").textContent).toBe("chart");
    expect(container.querySelectorAll("a,img,script,iframe,button").length).toBe(0);
    expect(container.textContent).toContain("footnote text");
    expect(container.textContent).toContain("external");
    expect(container.textContent).toContain("relative");
  });
  it.each([false, true])(
    "preserves exact BOM, mixed endings and trailing empty line with source annotations %s",
    (annotateSourceLines) => {
      const text = "\uFEFF---\r\ntitle: report\r---\n\n```unknown\r\n\t x  \r\n```\r\n";
      const model = createDocumentModel(text, "raw");
      const { rerender, container } = render(
        <MarkdownDocument model={model} view="raw" annotateSourceLines={annotateSourceLines} />,
      );
      expect(screen.getByLabelText("Raw Markdown").textContent).toBe(text);
      expect(container.querySelectorAll("[data-source-line]").length).toBe(
        annotateSourceLines ? 8 : 0,
      );
      if (annotateSourceLines)
        expect(container.querySelector('[data-source-line="8"]')?.textContent).toBe("");
      rerender(<MarkdownDocument model={model} view="preview" />);
      expect(container.textContent).toBe("\t x  \n");
      rerender(
        <MarkdownDocument model={model} view="raw" annotateSourceLines={annotateSourceLines} />,
      );
      expect(screen.getByLabelText("Raw Markdown").textContent).toBe(text);
      expect(Object.isFrozen(model)).toBe(true);
      expect(Object.isFrozen(model.headings)).toBe(true);
      expect(Object.isFrozen(model.requests)).toBe(true);
    },
  );
  it.each([30_000, 1024 * 1024])(
    "keeps %i newline bytes in default Raw without per-line DOM nodes",
    (size) => {
      const text = "\n".repeat(size);
      render(<MarkdownDocument model={createDocumentModel(text, "dense-raw")} view="raw" />);
      const raw = screen.getByLabelText("Raw Markdown");
      expect(raw.textContent).toBe(text);
      expect(raw.childNodes.length).toBe(1);
      expect(raw.querySelectorAll("[data-source-line]").length).toBe(0);
    },
  );
  it.each([30_000, 1024 * 1024])(
    "bounds annotated Raw DOM for %i newline bytes with exact inclusive range text",
    (size) => {
      const text = "\n".repeat(size);
      const model = createDocumentModel(text, "annotated-dense-raw");
      const { rerender } = render(
        <MarkdownDocument model={model} view="raw" annotateSourceLines />,
      );
      const raw = screen.getByLabelText("Raw Markdown");
      expect(raw.textContent).toBe(text);
      expect(raw.querySelectorAll("*").length).toBeLessThanOrEqual(132);
      expect(raw.querySelector(`[data-source-line="${size + 1}"]`)?.textContent).toBe("");
      const request = { startLineNumber: size - 10, endLineNumber: 3 };
      rerender(
        <MarkdownDocument model={model} view="raw" lineRange={request} annotateSourceLines />,
      );
      expect(raw.textContent).toBe(text);
      expect(raw.querySelectorAll("*").length).toBeLessThanOrEqual(132);
      expect(document.activeElement).toBe(raw.querySelector('[data-source-line="3"]'));
      expect(
        Array.from(raw.querySelectorAll('[data-highlighted="true"]'))
          .map((line) => line.textContent)
          .join(""),
      ).toBe("\n".repeat(size - 12));
      rerender(<MarkdownDocument model={model} view="raw" annotateSourceLines />);
      expect(raw.textContent).toBe(text);
      expect(raw.querySelectorAll('[data-highlighted="true"]').length).toBe(0);
      expect(document.activeElement).toBe(raw);
      expect(raw.querySelectorAll("*").length).toBeLessThanOrEqual(132);
    },
  );
  it("does not reclaim external focus when a grouped Raw range is cleared", () => {
    const model = createDocumentModel("line\n".repeat(1000), "external-focus");
    const { rerender } = render(
      <>
        <button>Outside</button>
        <MarkdownDocument
          model={model}
          view="raw"
          annotateSourceLines
          lineRange={{ startLineNumber: 7, endLineNumber: 7 }}
        />
      </>,
    );
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    rerender(
      <>
        <button>Outside</button>
        <MarkdownDocument model={model} view="raw" annotateSourceLines />
      </>,
    );
    expect(document.activeElement).toBe(outside);
    expect(screen.getByLabelText("Raw Markdown").textContent).toBe("line\n".repeat(1000));
  });
  it.each(["relative.png", "/api/private", "%ZZ", "https://", "javascript:alert(1)"])(
    "keeps invalid remote grant %j inert instead of throwing",
    (url) => {
      const { container } = render(
        <MarkdownDocument
          model={createDocumentModel("![plot](https://images.example/plot.png)", "invalid-remote")}
          view="preview"
          destinations={{
            kind: "delegated",
            resolve: () => ({ kind: "image", source: "remote", url }),
          }}
        />,
      );
      expect(container.querySelectorAll("img").length).toBe(0);
      expect(screen.getByText("plot").textContent).toBe("plot");
    },
  );
  it("never mounts active HTML/MDX and denies destinations by default", () => {
    const text =
      '<script>window.bad = true</script>\n\n<iframe src="https://example.org"></iframe>\n\n<Component onClick={run()} />\n\n[unsafe](javascript:alert%281%29) ![local](./secret.png) [fragment](#x) [malformed](%ZZ)';
    const { container } = render(
      <MarkdownDocument model={createDocumentModel(text, "deny")} view="preview" />,
    );
    expect(container.querySelectorAll("a,img,script,iframe,component").length).toBe(0);
    expect(container.textContent).toBe("\n\n\nunsafe local fragment malformed");
  });
  it("rejects lexical attacks before collection or delegated policy dispatch", () => {
    const urls = [
      "javascript:alert%281%29",
      "%ZZ",
      "%252e%252e/secret.md",
      "%2e%2e/secret.md",
      "https://user:pass@example.org/x",
      "https://example.org/a%2fb",
      "//bb.invalid/api",
      "/api/v1/private",
      "file:///etc/passwd",
      "C:/secret",
      "a%00b",
      "a%5cb",
      "a".repeat(4097),
    ];
    const model = createDocumentModel(
      urls.map((url, i) => `[bad${i}](${url})`).join("\n\n") + "\n\n[good](notes.md)",
      "safety",
    );
    const dispatched: string[] = [];
    const policy: DestinationPolicy = {
      kind: "delegated",
      resolve(request) {
        dispatched.push(request.url);
        return { kind: "bound-link", render: (props) => <a {...props} href="/approved" /> };
      },
    };
    const { container } = render(
      <MarkdownDocument model={model} view="preview" destinations={policy} />,
    );
    expect(model.requests).toEqual([{ url: "notes.md", image: false }]);
    expect(dispatched).toEqual(["notes.md"]);
    expect(container.querySelector("a")?.textContent).toBe("good");
    expect(container.querySelectorAll("a").length).toBe(1);
    expect(container.textContent).toContain("bad12");
  });
  it("bounds requests and images before dispatch without hiding readable labels", () => {
    const model = createDocumentModel(
      Array.from({ length: 140 }, (_, i) => `[link${i}](file${i}.md)`).join("\n\n"),
      "requests",
    );
    const imageModel = createDocumentModel(
      Array.from({ length: 34 }, (_, i) => `![image${i}](image${i}.png)`).join("\n\n"),
      "images",
    );
    expect(model.requests.length).toBe(128);
    expect(imageModel.requests.length).toBe(32);
    const ui = render(
      <MarkdownDocument
        model={imageModel}
        view="preview"
        destinations={{
          kind: "delegated",
          resolve: () => ({ kind: "image", source: "source", url: "/cap?asset=one" }),
        }}
      />,
    );
    expect(ui.container.querySelectorAll("img").length).toBe(32);
    expect(screen.getByText("image33").textContent).toBe("image33");
  });
  it("separates consumer-issued opaque local image grants from document-supplied BB URLs and mismatched link results", () => {
    const model = createDocumentModel(
      "![approved](plot.png) ![ungranted](other.png) ![bb](/api/v1/private) [mismatch](notes.md) ![mismatch-image](wrong.png)",
      "grants",
    );
    const policy: DestinationPolicy = {
      kind: "delegated",
      resolve(request) {
        if (request.url === "plot.png")
          return {
            kind: "image",
            source: "source",
            url: "/api/v1/plugins/reader/http/image?asset=opaque",
          };
        if (request.url === "notes.md") return { kind: "image", source: "source", url: "/bad" };
        if (request.url === "wrong.png")
          return { kind: "bound-link", render: (props) => <a {...props} href="/bad" /> };
        return undefined;
      },
    };
    const { container, rerender } = render(
      <MarkdownDocument model={model} view="preview" destinations={policy} />,
    );
    expect(container.querySelectorAll("img").length).toBe(1);
    expect(screen.getByRole("img", { name: "approved" }).getAttribute("src")).toBe(
      "/api/v1/plugins/reader/http/image?asset=opaque",
    );
    expect(container.querySelectorAll("a").length).toBe(0);
    expect(screen.getByText("bb").textContent).toBe("bb");
    rerender(<MarkdownDocument model={model} view="preview" destinations={localDestinations} />);
    expect(container.querySelectorAll("img").length).toBe(0);
    expect(screen.getByText("approved").textContent).toBe("approved");
  });
  it("only loads explicitly granted remote images without credentials or referrer and blocks the BB origin", () => {
    const model = createDocumentModel(
      `![remote](https://images.example/plot.png) ![bb](${location.origin}/private.png)`,
      "remote",
    );
    const { container } = render(
      <MarkdownDocument
        model={model}
        view="preview"
        destinations={{
          kind: "delegated",
          resolve: (request) => ({ kind: "image", source: "remote", url: request.url }),
        }}
      />,
    );
    const image = screen.getByRole("img", { name: "remote" });
    expect(image.getAttribute("crossorigin")).toBe("anonymous");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(container.querySelectorAll("img").length).toBe(1);
    expect(screen.getByText("bb").textContent).toBe("bb");
  });
  it("keeps repeated range intents and local heading focus in the supplied document", () => {
    const text = "# 日本語\r\n\r\n## 日本語\nlast\n";
    const model = createDocumentModel(text, "local");
    const revealed: string[] = [];
    const navigation = {
      reveal: (target: HTMLElement) => {
        revealed.push(target.dataset.sourceLine ?? target.id);
        target.focus();
      },
    };
    const { rerender, container } = render(
      <MarkdownDocument
        model={model}
        view="raw"
        lineRange={{ startLineNumber: 9, endLineNumber: 3 }}
        navigation={navigation}
      />,
    );
    expect(
      Array.from(
        container.querySelectorAll('[data-highlighted="true"]'),
        (node) => node.textContent,
      ),
    ).toEqual(["## 日本語\n", "last\n", ""]);
    rerender(
      <MarkdownDocument
        model={model}
        view="raw"
        lineRange={{ startLineNumber: 9, endLineNumber: 3 }}
        navigation={navigation}
      />,
    );
    expect(revealed).toEqual(["3", "3"]);
    rerender(
      <MarkdownDocument
        model={model}
        view="preview"
        destinations={localDestinations}
        outline
        navigation={navigation}
      />,
    );
    fireEvent.click(screen.getAllByRole("link", { name: "日本語" })[1]!);
    expect(document.activeElement).toBe(document.getElementById(model.headings[1]!.id));
    expect(model.headings.map((h) => [h.fragment, h.line])).toEqual([
      ["日本語", 1],
      ["日本語-1", 3],
    ]);
  });
  it("focuses local headings without scrolling an outside container or page", () => {
    const previous = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
    const pageScroll = document.documentElement.scrollTop;
    const model = createDocumentModel("# Target\n\n[Jump](#target)", "owned-navigation");
    const { container } = render(
      <div data-outside style={{ overflowY: "auto", height: 100 }}>
        <MarkdownDocument model={model} view="preview" destinations={localDestinations} outline />
      </div>,
    );
    const outside = container.querySelector<HTMLElement>("[data-outside]")!;
    outside.scrollTop = 64;
    document.documentElement.scrollTop = 240;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value() {
        outside.scrollTop = 0;
        document.documentElement.scrollTop = 0;
      },
    });
    try {
      fireEvent.click(screen.getByRole("link", { name: "Jump" }));
      expect(document.activeElement).toBe(document.getElementById(model.headings[0]!.id));
      expect(outside.scrollTop).toBe(64);
      expect(document.documentElement.scrollTop).toBe(240);
      fireEvent.click(screen.getByRole("link", { name: "Target" }));
      expect(outside.scrollTop).toBe(64);
      expect(document.documentElement.scrollTop).toBe(240);
    } finally {
      if (previous) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", previous);
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
      document.documentElement.scrollTop = pageScroll;
    }
  });
  it("preserves the rendered title on an approved external link", () => {
    const model = createDocumentModel(
      '[report](https://example.org/report "Source report")',
      "title",
    );
    render(
      <MarkdownDocument
        model={model}
        view="preview"
        destinations={{ kind: "attachment", openExternal: () => true }}
      />,
    );
    expect(screen.getByRole("link", { name: "report" }).getAttribute("title")).toBe(
      "Source report",
    );
  });
  it("renders plain Raw without requesting a source-line index", () => {
    const source = "\uFEFF\r\n\t  \n";
    const model = createDocumentModel(source, "lazy-lines");
    const sourceLines = {
      text: source,
      get lines(): readonly string[] {
        throw new Error("Unexpected source-line index");
      },
      target: () => null,
    };
    render(<MarkdownDocument model={{ ...model, sourceLines }} view="raw" />);
    expect(screen.getByLabelText("Raw Markdown").textContent).toBe(source);
  });
  it.each(["\u00a0", "\u2003"])("preserves non-ASCII paragraph whitespace %j", (source) => {
    const model = createDocumentModel(source, "unicode-space");
    const { container } = render(<MarkdownDocument model={model} view="preview" />);
    expect(container.querySelector("p")?.textContent).toBe(source);
  });
  it.each([
    denyDestinations,
    { kind: "attachment", localFragments: false },
    {
      kind: "bound-source",
      localFragments: false,
      binding: { root: "/docs", host: "host", documentPath: "/docs/current.md" },
      activateSource: () => true,
    },
  ] satisfies DestinationPolicy[])(
    "keeps disabled local navigation inert with an explicit outline for $kind",
    (policy) => {
      const model = createDocumentModel("# Target\n\n[jump](#target)", "outline-permission");
      render(<MarkdownDocument model={model} view="preview" destinations={policy} outline />);
      expect(screen.queryByRole("navigation")).toBeNull();
      expect(screen.getByText("jump").tagName).toBe("SPAN");
      expect(screen.getByRole("heading", { name: "Target" }).id).toBe(model.headings[0]!.id);
    },
  );
});
