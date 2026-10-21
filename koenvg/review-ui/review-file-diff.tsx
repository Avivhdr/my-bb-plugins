import { useCallback, type ReactNode } from "react";
import { DIFFS_TAG_NAME, type DiffLineAnnotation, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import type { DiffSide } from "./diff-lines";

export type DiffView = "unified" | "split";

export interface CodeTheme {
  name: string;
  mode: "light" | "dark";
}

export interface ReviewFileDiffProps<T> {
  fileDiff: FileDiffMetadata;
  annotations: DiffLineAnnotation<T>[];
  renderAnnotation: (annotation: DiffLineAnnotation<T>) => ReactNode;
  onAddComment?: (side: DiffSide, line: number) => void;
  view: DiffView;
  theme: CodeTheme;
  customHeader?: ReactNode;
  headerPrefix?: ReactNode;
  headerMetadata?: ReactNode;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onPostRender?: (node: HTMLElement) => void;
}

export function ReviewFileDiff<T>({
  fileDiff,
  annotations,
  renderAnnotation,
  onAddComment,
  view,
  theme,
  customHeader,
  headerPrefix,
  headerMetadata,
  collapsed = false,
  onToggleCollapsed,
  onPostRender,
}: ReviewFileDiffProps<T>) {
  const renderCustomHeader = useCallback(() => customHeader, [customHeader]);
  const hasCustomHeader = customHeader != null;
  return (
    <FileDiff
      fileDiff={fileDiff}
      options={{
        theme: theme.name,
        themeType: theme.mode,
        overflow: "wrap",
        stickyHeader: true,
        collapsed,
        unsafeCSS:
          onToggleCollapsed === undefined
            ? undefined
            : `[data-diffs-header] [role="button"] { cursor: pointer; }
               [data-diffs-header] [role="button"]:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }`,
        onPostRender: (node) => {
          const filenames = node.shadowRoot?.querySelectorAll<HTMLElement>(
            "[data-diffs-header] [data-title], [data-diffs-header] [data-prev-name]",
          );
          filenames?.forEach((filename) => {
            filename.onclick = onToggleCollapsed ?? null;
            filename.onkeydown =
              onToggleCollapsed === undefined
                ? null
                : (event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    if (!event.repeat) onToggleCollapsed();
                  };
            if (onToggleCollapsed === undefined) {
              filename.removeAttribute("role");
              filename.removeAttribute("tabindex");
              filename.removeAttribute("aria-expanded");
            } else {
              filename.setAttribute("role", "button");
              filename.tabIndex = 0;
              filename.setAttribute("aria-expanded", String(!collapsed));
            }
          });
          onPostRender?.(node);
        },
        diffStyle: view,
        enableGutterUtility: onAddComment !== undefined,
        onGutterUtilityClick:
          onAddComment === undefined
            ? undefined
            : (range) => onAddComment(range.side ?? "additions", range.start),
      }}
      lineAnnotations={annotations}
      renderAnnotation={(annotation) => (
        <div style={{ contain: "inline-size" }}>{renderAnnotation(annotation)}</div>
      )}
      renderCustomHeader={hasCustomHeader ? renderCustomHeader : undefined}
      renderHeaderPrefix={
        hasCustomHeader || headerPrefix === undefined ? undefined : () => headerPrefix
      }
      renderHeaderMetadata={
        hasCustomHeader || headerMetadata === undefined ? undefined : () => headerMetadata
      }
    />
  );
}

export function stickyHeaderHeight(element: Element): number {
  const header = element
    .closest(DIFFS_TAG_NAME)
    ?.shadowRoot?.querySelector("[data-diffs-header][data-sticky]");
  return header?.getBoundingClientRect().height ?? 0;
}
