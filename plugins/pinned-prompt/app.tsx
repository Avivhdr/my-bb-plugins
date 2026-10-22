import { useEffect, useRef, useState } from "react";
import { definePluginApp, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { findChatViews, rowBoxes, rowText, scrollToRow, type ChatView } from "./dom";
import { indexPrompts, oneLine, pinFor, type Pin, type PromptIndex } from "./model";

/** Don't ask the server about one thread more often than this. */
const REFETCH_MS = 3000;
/** Catches layout changes that fire no scroll event, like streaming output. */
const POLL_MS = 750;
/** The bar's offset from the top of the chat. */
const BAR_OFFSET = 6;
/** Rows under the bar count as scrolled away. */
const BAR_SPACE = 40;

interface Bar {
  view: ChatView;
  pin: Pin;
  top: number;
  left: number;
  width: number;
}

const sameBars = (a: readonly Bar[], b: readonly Bar[]) =>
  a.length === b.length &&
  a.every(
    (bar, i) =>
      bar.view.list === b[i]!.view.list &&
      bar.pin.rowId === b[i]!.pin.rowId &&
      bar.pin.text === b[i]!.pin.text &&
      bar.top === b[i]!.top &&
      bar.left === b[i]!.left &&
      bar.width === b[i]!.width,
  );

function PinnedPrompts() {
  const rpc = useRpc<typeof rpcContract>();
  const [bars, setBars] = useState<Bar[]>([]);
  const indexes = useRef(new Map<string, PromptIndex>());

  useEffect(() => {
    const fetchedAt = new Map<string, number>();
    let frame = 0;
    let disposed = false;

    const load = (threadId: string) => {
      const now = Date.now();
      if (now - (fetchedAt.get(threadId) ?? 0) < REFETCH_MS) return;
      fetchedAt.set(threadId, now);
      rpc.call("prompts", { threadId }).then(
        (result) => {
          indexes.current.set(threadId, indexPrompts(result));
          schedule();
        },
        () => {},
      );
    };

    const update = () => {
      frame = 0;
      const next: Bar[] = [];
      for (const view of findChatViews()) {
        const area = view.scroller.getBoundingClientRect();
        const column = view.list.getBoundingClientRect();
        if (area.height === 0 || column.width === 0) continue;
        const { pin, stale } = pinFor(
          indexes.current.get(view.threadId) ?? null,
          rowBoxes(view),
          area.top + BAR_SPACE,
          area.bottom,
          (rowId) => rowText(view, rowId),
        );
        if (stale) load(view.threadId);
        if (pin) {
          next.push({ view, pin, top: Math.round(area.top) + BAR_OFFSET, left: Math.round(column.left), width: Math.round(column.width) });
        }
      }
      setBars((previous) => (sameBars(previous, next) ? previous : next));
    };

    const schedule = () => {
      if (!disposed && frame === 0) frame = requestAnimationFrame(update);
    };

    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    const timer = setInterval(schedule, POLL_MS);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      clearInterval(timer);
    };
  }, [rpc]);

  return bars.map((bar) => {
    const text = oneLine(bar.pin.text);
    const positions = indexes.current.get(bar.view.threadId)?.positions ?? new Map<string, number>();
    return (
      <button
        key={bar.view.threadId}
        type="button"
        title={bar.pin.text}
        aria-label={`Scroll to your message: ${text}`}
        onClick={() => void scrollToRow(bar.view, bar.pin.rowId, bar.pin.index, positions)}
        style={{ position: "fixed", top: bar.top, left: bar.left, width: bar.width }}
        className="z-30 flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-secondary px-3 py-1.5 text-left text-sm text-foreground shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 shrink-0 text-muted-foreground">
          <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 flex-1 truncate">{text}</span>
      </button>
    );
  });
}

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "pinned-prompt", component: PinnedPrompts });
});
