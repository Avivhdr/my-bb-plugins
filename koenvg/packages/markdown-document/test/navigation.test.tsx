// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { type DestinationPolicy } from "@bb-plugins/markdown-document";
import { ModelDocument as MarkdownDocument } from "./consumer.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const local: DestinationPolicy = { kind: "attachment", localFragments: true };
it("derives formatted Unicode headings, raw-skipped labels and suffix collisions from rendered content", () => {
  const { container } = render(
    <MarkdownDocument
      namespace="same"
      view="preview"
      destinations={local}
      text={
        "# Café **bold** `code` [link](https://example.org) ![chart](./x) <i>tag</i>\n\n## Same\n\n## Same\n\n## Same-1\n\n## 同じ\n\n## 同じ\n\n## !!!"
      }
    />,
  );
  const headings = screen.getAllByRole("heading");
  expect(headings.map((node) => node.textContent)).toEqual([
    "Café bold code link chart tag",
    "Same",
    "Same",
    "Same-1",
    "同じ",
    "同じ",
    "!!!",
  ]);
  const links = within(screen.getByRole("navigation")).getAllByRole("link", { hidden: true });
  expect(links.map((node) => node.textContent)).toEqual([
    "Café bold code link chart tag",
    "Same",
    "Same",
    "Same-1",
    "同じ",
    "同じ",
    "!!!",
  ]);
  expect(headings.map((node) => node.id.split("-heading-")[1])).toEqual([
    "café-bold-code-link-chart-tag",
    "same",
    "same-1",
    "same-1-1",
    "同じ",
    "同じ-1",
    "section",
  ]);
  expect(container.querySelector("h1 strong")?.textContent).toBe("bold");
  fireEvent.click(links[3]!);
  expect(document.activeElement).toBe(headings[3]);
});
it("keeps repeated namespaces, fragments and generated footnote ID references document-local", () => {
  const text =
    "# Same\n\n[jump](#same) [unknown](#missing) [bad](#%ZZ)\n\nNote[^1].\n\n[^1]: Footnote.";
  const { container } = render(
    <>
      <h1 id="same">Task heading</h1>
      {[0, 1].map((index) => (
        <MarkdownDocument
          key={index}
          namespace="repeated"
          view="preview"
          destinations={local}
          text={text}
        />
      ))}
    </>,
  );
  const readers = container.querySelectorAll<HTMLElement>(".md-document");
  const ids = Array.from(container.querySelectorAll("[id]")).map((node) => node.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const reader of Array.from(readers)) {
    const heading = within(reader).getByRole("heading", { name: "Same" });
    const link = within(reader).getByRole("link", { name: "jump" });
    fireEvent.click(link, { ctrlKey: true });
    expect(document.activeElement).toBe(heading);
    fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(heading);
    expect(within(reader).getByText("unknown").tagName).toBe("SPAN");
    expect(within(reader).getByText("bad").tagName).toBe("SPAN");
    const note = within(reader).getByRole("link", { name: "1" });
    const described = note.getAttribute("aria-describedby");
    expect(
      Array.from(reader.querySelectorAll("[id]")).find((node) => node.id === described)
        ?.textContent,
    ).toBe("Footnotes");
    fireEvent.click(note);
    expect(document.activeElement?.textContent).toContain("Footnote.");
    expect(reader.contains(document.activeElement)).toBe(true);
    expect(within(reader).getByRole("navigation").textContent).toBe("On this pageSame");
  }
  expect(location.hash).toBe("");
});
it("hides outline chrome without removing targets and omits empty and Raw outlines", () => {
  const { rerender } = render(
    <MarkdownDocument
      namespace="hidden"
      view="preview"
      destinations={local}
      outline={false}
      text={"# Target\n\n[jump](#target)"}
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "jump" }));
  expect(document.activeElement?.textContent).toBe("Target");
  expect(screen.queryByRole("navigation")).toBeNull();
  rerender(
    <MarkdownDocument
      namespace="hidden"
      view="preview"
      destinations={local}
      text="Plain content"
    />,
  );
  expect(screen.getByText("Plain content").tagName).toBe("P");
  expect(screen.queryByRole("navigation")).toBeNull();
  rerender(<MarkdownDocument namespace="hidden" view="raw" destinations={local} text="# Raw" />);
  expect(screen.getByLabelText("Raw Markdown").textContent).toBe("# Raw");
  expect(screen.queryByRole("navigation")).toBeNull();
});
it("retains safe hrefs and native modifiers but suppresses ordinary fallback on false and thrown opens", async () => {
  const open = vi
    .fn()
    .mockReturnValueOnce(false)
    .mockImplementationOnce(() => {
      throw new Error("host failure");
    })
    .mockReturnValue(true);
  render(
    <MarkdownDocument
      namespace="external"
      view="preview"
      destinations={{ kind: "attachment", openExternal: open }}
      text="[safe](https://example.org/path?q=1#x)"
    />,
  );
  const link = screen.getByRole("link", { name: "safe" });
  expect(link.getAttribute("href")).toBe("https://example.org/path?q=1#x");
  expect(link.getAttribute("target")).toBeNull();
  for (const modifier of ["ctrlKey", "metaKey", "shiftKey", "altKey"]) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, [modifier]: true });
    link.addEventListener("click", (native) => native.preventDefault(), { once: true });
    fireEvent(link, event);
  }
  fireEvent(link, new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true }));
  expect(fireEvent.contextMenu(link)).toBe(true);
  expect(fireEvent.click(link, { button: 2 })).toBe(true);
  expect(open.mock.calls).toEqual([]);
  expect(fireEvent.click(link)).toBe(false);
  expect((await screen.findByRole("status")).textContent).toBe("Link could not be opened.");
  expect(fireEvent.click(link)).toBe(false);
  expect((await screen.findByRole("status")).textContent).toBe("Link could not be opened.");
  fireEvent.click(link);
  expect(open.mock.calls).toEqual([
    ["https://example.org/path?q=1#x"],
    ["https://example.org/path?q=1#x"],
    ["https://example.org/path?q=1#x"],
  ]);
});
it("fails closed before permissive source dispatch while allowing one confined bound fixture", () => {
  const activate = vi.fn(() => true);
  const open = vi.fn(() => true);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const bad = [
    "../../../secret.md",
    "/root-other/file.md",
    "//other-host/path",
    "%ZZ",
    "https:example.org",
    "https://u:p@example.org",
    "javascript:alert%281%29",
    "mailto:me@example.org",
    "a%00b",
    "a%5cb",
    "%2f%2fother/path",
    "https://example.org/%0a",
    "a%252f..%252fsecret",
    "notes%23secret",
    "file:///root/notes.md",
    "C:%5csecret",
  ];
  const text = `[allowed](./notes.md#section) ![source asset](./chart.png) ${bad.map((value, index) => `[bad${index}](${value}) ![alt${index}](${value})`).join(" ")}`;
  const { container, rerender } = render(
    <MarkdownDocument
      namespace="source"
      view="preview"
      destinations={{
        kind: "bound-source",
        binding: { root: "/root", host: "fixture-host", documentPath: "/root/reports/main.md" },
        activateSource: activate,
        openExternal: open,
        remoteImages: true,
      }}
      text={text}
    />,
  );
  const link = screen.getByRole("link", { name: "allowed" });
  expect(link.hasAttribute("href")).toBe(false);
  fireEvent.click(link);
  expect(activate.mock.calls).toEqual([
    [{ host: "fixture-host", path: "/root/reports/notes.md", fragment: "section" }],
  ]);
  for (let index = 0; index < bad.length; index++) {
    expect(screen.getByText(`bad${index}`).tagName).toBe("SPAN");
    expect(screen.getByRole("img", { name: `alt${index}` }).textContent).toBe(`alt${index}`);
    fireEvent.click(screen.getByText(`bad${index}`));
  }
  expect(screen.getByRole("img", { name: "source asset" }).textContent).toBe("source asset");
  expect(container.querySelectorAll("a").length).toBe(1);
  expect(fetch.mock.calls).toEqual([]);
  expect(open.mock.calls).toEqual([]);
  expect(activate.mock.calls).toEqual([
    [{ host: "fixture-host", path: "/root/reports/notes.md", fragment: "section" }],
  ]);
  rerender(
    <MarkdownDocument
      namespace="source"
      view="preview"
      destinations={{ kind: "attachment" }}
      text="[relative](./notes.md) [absolute](/root/notes.md) [web](https://example.org) ![remote](https://example.org/chart.png)"
    />,
  );
  expect(container.querySelectorAll("a,img").length).toBe(0);
  expect(container.textContent).toBe("relative absolute web remote");
});

it("separates literal generated-ID heading slugs from footnote references and normalizes Unicode once", () => {
  render(
    <MarkdownDocument
      namespace="collisions"
      view="preview"
      destinations={local}
      text={
        "# user-content-fn-1\n\n[jump heading](#user-content-fn-1) Note[^1].\n\n## Café\n\n## Cafe\u0301\n\n[^1]: Footnote target."
      }
    />,
  );
  fireEvent.click(screen.getByRole("link", { name: "jump heading" }));
  expect(document.activeElement).toBe(screen.getByRole("heading", { name: "user-content-fn-1" }));
  fireEvent.click(screen.getByRole("link", { name: "1" }));
  expect(document.activeElement?.tagName).toBe("LI");
  expect(document.activeElement?.textContent).toContain("Footnote target.");
  fireEvent.click(screen.getByRole("link", { name: "Back to reference 1" }));
  expect(document.activeElement).toBe(screen.getByRole("link", { name: "1" }));
  const headings = screen
    .getAllByRole("heading", { level: 2 })
    .filter((node) => node.textContent !== "Footnotes");
  expect(headings.map((node) => node.id.split("-heading-")[1])).toEqual(["café", "café-1"]);
  expect(
    within(screen.getByRole("navigation"))
      .getAllByRole("link", { hidden: true })
      .map((link) => link.textContent),
  ).toEqual(["user-content-fn-1", "Café", "Café"]);
});
