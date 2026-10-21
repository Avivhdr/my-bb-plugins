export const RESET = "ol,ul,menu { list-style:none; padding:0; margin:0; }";

export function measure(root: HTMLElement) {
  const rect = (e: Element) => {
    const r = e.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  };
  const lists = Array.from(
    root.querySelectorAll<HTMLOListElement | HTMLUListElement>(".mr-prose ol,.mr-prose ul"),
  ).map((e) => ({
    tag: e.tagName,
    start: "start" in e ? e.start : null,
    nested: !!e.closest("li"),
    type: getComputedStyle(e).listStyleType,
    indent: parseFloat(getComputedStyle(e).paddingLeft),
    footnote: !!e.closest("[data-footnotes]"),
    items: Array.from(e.children).map((li) => ({
      task: li.classList.contains("task-list-item"),
      type: getComputedStyle(li).listStyleType,
      display: getComputedStyle(li).display,
      disabled: li.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled ?? null,
    })),
  }));
  const toolbar = root.querySelector(".mr-toolbar")!,
    identity = root.querySelector<HTMLElement>(".mr-identity");
  const view = root.querySelector(".mr-view-controls")!,
    actions = root.querySelector(".mr-reader-actions");
  const filename = root.querySelector(".mr-filename"),
    directory = root.querySelector(".mr-path");
  const outline = Array.from(toolbar.querySelectorAll("button")).find(
    (b) => b.getAttribute("aria-label") === "Outline",
  );
  return {
    width: root.clientWidth,
    scrollWidth: root.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewport: innerWidth,
    toolbar: rect(toolbar),
    identity: identity ? rect(identity) : null,
    fullPath: identity?.getAttribute("aria-label"),
    title: identity?.title,
    filename: filename?.textContent,
    filenameSize: filename ? getComputedStyle(filename).fontSize : null,
    directorySize: directory ? getComputedStyle(directory).fontSize : null,
    view: rect(view),
    actions: actions ? rect(actions) : null,
    outlineBackground:
      root.querySelector('button[aria-pressed="true"]') && outline
        ? getComputedStyle(outline).backgroundColor
        : null,
    buttons: Array.from(toolbar.querySelectorAll("button")).map((b) => ({
      name: b.getAttribute("aria-label") || b.textContent,
      ...rect(b),
    })),
    lists,
    outsideType: getComputedStyle(document.querySelector("#outside-list")!).listStyleType,
  };
}
