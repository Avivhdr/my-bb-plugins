export function measureDocument() {
  const root = document.querySelector<HTMLElement>(".md-document")!;
  const prose = root.querySelector<HTMLElement>(".mr-prose")!;
  const selectors = [
    ".mr-prose",
    "h1",
    "h2",
    "h3",
    "p",
    "pre",
    "pre code",
    "th",
    "td",
    "blockquote",
    "ul",
    "ol",
    "li",
    ".mr-image-placeholder, .mr-prose [role='img']",
  ];
  const properties = [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "letter-spacing",
    "color",
    "background-color",
    "margin-top",
    "margin-bottom",
    "padding-left",
    "padding-right",
    "border-left-width",
    "border-top-width",
    "border-radius",
    "overflow-x",
    "list-style-type",
    "white-space",
  ];
  return {
    width: prose.getBoundingClientRect().width,
    content: prose.textContent,
    headings: Array.from(
      prose.querySelectorAll("h1:not(.sr-only),h2:not(.sr-only),h3:not(.sr-only)"),
      (node) => [node.tagName, node.textContent],
    ),
    styles: Object.fromEntries(
      selectors.map((selector) => {
        const node = root.querySelector(selector)!;
        const style = getComputedStyle(node);
        return [
          selector,
          Object.fromEntries(
            properties.map((property) => [property, style.getPropertyValue(property)]),
          ),
        ];
      }),
    ),
    codeText: root.querySelector("pre code")!.textContent,
    tokens: root.querySelectorAll("pre code .token").length,
    orderedStart: root.querySelector("ol")!.getAttribute("start"),
    checkboxes: Array.from(
      root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      (node) => [node.checked, node.disabled],
    ),
    overflow: {
      page: document.documentElement.scrollWidth > innerWidth,
      code: root.querySelector("pre")!.scrollWidth > root.querySelector("pre")!.clientWidth,
      table: getComputedStyle(root.querySelector(".mr-table-scroll")!).overflowX,
    },
  };
}
