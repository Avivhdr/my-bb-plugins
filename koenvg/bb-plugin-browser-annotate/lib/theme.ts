import { useEffect, useState } from "react";
import type { PageTheme } from "./page/annotator";

const TOKENS: Record<keyof PageTheme, readonly string[]> = {
  surface: ["--popover", "--background"],
  text: ["--popover-foreground", "--foreground"],
  mutedText: ["--muted-foreground"],
  border: ["--border"],
  input: ["--background"],
  accent: ["--primary"],
  accentText: ["--primary-foreground"],
  ring: ["--ring", "--primary"],
  danger: ["--destructive"],
  font: ["--font-sans"],
};

export function readHostTheme(root: HTMLElement = document.documentElement): PageTheme {
  const style = getComputedStyle(root);
  const theme = {} as PageTheme;
  for (const [key, names] of Object.entries(TOKENS) as [keyof PageTheme, readonly string[]][]) {
    theme[key] = names.map((name) => style.getPropertyValue(name).trim()).find(Boolean) ?? "";
  }
  return theme;
}

export function useHostTheme(): PageTheme {
  const [theme, setTheme] = useState(readHostTheme);
  useEffect(() => {
    const update = () =>
      setTheme((current) => {
        const next = readHostTheme();
        return JSON.stringify(next) === JSON.stringify(current) ? current : next;
      });
    const observer = new MutationObserver(update);
    for (const node of [document.documentElement, document.body].filter(Boolean)) {
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["class", "style", "data-theme"],
      });
    }
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    const scheme = window.matchMedia?.("(prefers-color-scheme: dark)");
    scheme?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      scheme?.removeEventListener("change", update);
    };
  }, []);
  return theme;
}
