import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { experimental_Icon as Icon } from "@get-bb/plugin-sdk/app";
import type { TextSnapshot } from "./source";

export interface ExcerptDestination {
  key: string;
  available: boolean;
  append: (quote: string) => string | null;
}
interface Capture {
  text: string;
  rect: DOMRect;
  snapshot: TextSnapshot;
  view: "preview" | "raw";
  destination: ExcerptDestination;
  revision: number;
  lines?: { start: number; end: number };
}
function selectedLines(root: Element, range: Range, text: string) {
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const startOffset = prefix.toString().length;
  const endOffset = startOffset + range.toString().length;
  let start = 1;
  let end = 1;
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    const nextLineOffset = match.index + match[0].length;
    if (nextLineOffset <= startOffset) start++;
    if (nextLineOffset < endOffset) end++;
    else break;
  }
  return { start, end };
}
function quote(capture: Capture) {
  const { snapshot, text } = capture;
  const { source, path } = snapshot.target;
  const pathReference = source.kind === "host" ? snapshot.documentPath : path;
  const reference = capture.lines
    ? `${pathReference}:${capture.lines.start}-${capture.lines.end}`
    : pathReference;
  const provenance = [
    source.kind,
    `host ${snapshot.hostId}`,
    ...(source.kind === "thread-storage" ? [`owner thread ${source.threadId}`] : []),
    ...(source.kind === "workspace" && source.projectId ? [`project ${source.projectId}`] : []),
    ...(source.kind === "workspace" && source.environmentId
      ? [`environment ${source.environmentId}`]
      : []),
  ].join(" · ");
  return (
    [reference, provenance, ...text.replace(/\r\n?/g, "\n").split("\n")]
      .map((line) => `> ${line}`)
      .join("\n") + "\n"
  );
}

/** Owns only this reader's selection. Draft writes stay with the slot owner. */
export function SelectionAction({
  panel,
  snapshot,
  view,
  destination,
  revision,
}: {
  panel: RefObject<HTMLElement | null>;
  snapshot: TextSnapshot | null;
  view: "preview" | "raw";
  destination?: ExcerptDestination;
  revision: number;
}) {
  const [capture, setCapture] = useState<Capture | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const pending = useRef<Capture | null>(null);
  const dismissed = useRef<Range | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const key = destination?.key;
  const available = destination?.available;
  useLayoutEffect(() => {
    const selectionNow = panel.current?.ownerDocument.defaultView?.getSelection();
    dismissed.current = selectionNow?.rangeCount ? selectionNow.getRangeAt(0).cloneRange() : null;
    pending.current = null;
    setCapture(null);
    setFeedback(null);
    if (!snapshot || !destination) return;
    const doc = panel.current!.ownerDocument;
    const win = doc.defaultView!;
    const coarse = win.matchMedia?.("(pointer: coarse)");
    let dragging = false;
    const dismiss = () => {
      const selectionNow = win.getSelection();
      dismissed.current = selectionNow?.rangeCount ? selectionNow.getRangeAt(0).cloneRange() : null;
      pending.current = null;
      setCapture(null);
    };
    const report = () => {
      if (dragging || menu.current?.contains(doc.activeElement)) return;
      if (coarse?.matches) {
        dismiss();
        return;
      }
      const selection = win.getSelection();
      const root = panel.current?.querySelector(view === "raw" ? ".mr-raw" : ".mr-prose");
      if (!root || !selection || selection.isCollapsed || selection.rangeCount !== 1) {
        dismiss();
        return;
      }
      const range = selection.getRangeAt(0);
      const previous = dismissed.current;
      if (
        previous &&
        previous.startContainer === range.startContainer &&
        previous.startOffset === range.startOffset &&
        previous.endContainer === range.endContainer &&
        previous.endOffset === range.endOffset
      )
        return;
      const text = selection.toString();
      if (
        !root.contains(range.startContainer) ||
        !root.contains(range.endContainer) ||
        !root.contains(range.commonAncestorContainer) ||
        !text.trim()
      ) {
        dismiss();
        return;
      }
      const rect = range.getBoundingClientRect?.() ?? panel.current!.getBoundingClientRect();
      const next = {
        text,
        rect,
        snapshot,
        view,
        destination,
        revision,
        lines: view === "raw" ? selectedLines(root, range, snapshot.text) : undefined,
      };
      pending.current = next;
      setFeedback(null);
      setCapture(next);
    };
    const down = (event: PointerEvent) => {
      if (menu.current?.contains(event.target as Node)) return;
      dismiss();
      dragging = true;
      const root = panel.current?.querySelector(view === "raw" ? ".mr-raw" : ".mr-prose");
      if (root?.contains(event.target as Node)) dismissed.current = null;
    };
    const up = (event: PointerEvent) => {
      dragging = false;
      if (!menu.current?.contains(event.target as Node)) report();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const keyup = (event: KeyboardEvent) => {
      if (
        event.shiftKey &&
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
      )
        report();
    };
    doc.addEventListener("selectionchange", report);
    doc.addEventListener("pointerdown", down, true);
    doc.addEventListener("pointerup", up);
    doc.addEventListener("keydown", keyboard, true);
    doc.addEventListener("keyup", keyup);
    win.addEventListener("scroll", dismiss, true);
    win.addEventListener("resize", dismiss);
    coarse?.addEventListener("change", dismiss);
    return () => {
      pending.current = null;
      doc.removeEventListener("selectionchange", report);
      doc.removeEventListener("pointerdown", down, true);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("keydown", keyboard, true);
      doc.removeEventListener("keyup", keyup);
      win.removeEventListener("scroll", dismiss, true);
      win.removeEventListener("resize", dismiss);
      coarse?.removeEventListener("change", dismiss);
    };
  }, [panel, snapshot, view, key, available, revision]);
  useLayoutEffect(() => {
    if (!capture || !menu.current || !panel.current) return;
    const bounds = panel.current.getBoundingClientRect();
    const rect = menu.current.getBoundingClientRect();
    const left = Math.max(
      bounds.left + 4,
      Math.min(capture.rect.left, bounds.right - rect.width - 4),
    );
    const top = Math.max(
      bounds.top + 4,
      Math.min(capture.rect.bottom + 6, bounds.bottom - rect.height - 4),
    );
    setPosition({ left, top });
  }, [capture, panel]);
  const current =
    capture &&
    snapshot === capture.snapshot &&
    view === capture.view &&
    key === capture.destination.key &&
    available === capture.destination.available &&
    revision === capture.revision;
  const activate = () => {
    const selected = pending.current;
    if (!current || selected !== capture || !destination?.available) return;
    pending.current = null;
    setCapture(null);
    // Consume before focus or insertion can fire another browser event.
    panel.current?.ownerDocument.defaultView?.getSelection()?.removeAllRanges();
    setFeedback(destination.append(quote(selected)));
  };
  return (
    <>
      {current && (
        <div ref={menu} className="mr-selection-menu" style={position}>
          <button
            type="button"
            aria-disabled={!destination?.available}
            title={!destination?.available ? "No associated chat draft is available." : undefined}
            onPointerDown={(event) => event.preventDefault()}
            onClick={activate}
          >
            <Icon name="MessageSquare" className="mr-icon" aria-hidden="true" />
            Add to chat
          </button>
          {!destination?.available && (
            <span role="status">No associated chat draft is available.</span>
          )}
        </div>
      )}
      {feedback && (
        <div className="mr-selection-feedback" role="alert" style={position}>
          {feedback}
        </div>
      )}
    </>
  );
}
