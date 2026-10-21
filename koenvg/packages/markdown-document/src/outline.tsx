import { useEffect, useState, type RefObject } from "react";
import type { DocumentModel } from "./model.js";

export function useWidePanel(root: RefObject<HTMLElement | null>, enabled = true) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const panel = root.current;
    if (!enabled || !panel || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.find((entry) => entry.target === panel);
      if (entry) setWide(entry.contentRect.width > 1080);
    });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [root, enabled]);
  return wide;
}

export function Outline({ model, wide }: { model: DocumentModel; wide: boolean }) {
  const entries = model.headings.map((heading) => (
    <a
      key={heading.id}
      href={`#${heading.id}`}
      data-heading-target={heading.id}
      style={{ paddingInlineStart: 12 + (heading.level - 1) * 8 }}
      aria-label={heading.text || "Empty heading"}
    >
      {heading.text}
    </a>
  ));
  return wide ? (
    <aside className="mr-outline-aside" aria-label="On this page">
      <p>On this page</p>
      <nav aria-label="Document sections">{entries}</nav>
    </aside>
  ) : (
    <nav aria-label="Document sections">
      <details className="mr-outline-inline">
        <summary>On this page</summary>
        {entries}
      </details>
    </nav>
  );
}
