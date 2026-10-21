// Reads bb's chat DOM. These selectors are bb internals, not SDK contract, so a
// bb release can break them. Everything here fails soft: no view, no pin.
import { threadIdOf, oneLine, type RowBox } from "./model";

const LIST = "[data-timeline-row-list]";
const ROW = "[data-timeline-row-id]";
/** Space left above a prompt after scrolling to it. */
const GAP = 12;

export interface ChatView {
  threadId: string;
  list: HTMLElement;
  scroller: HTMLElement;
}

/** Every open thread chat, one per pane. */
export function findChatViews(): ChatView[] {
  const views: ChatView[] = [];
  for (const list of document.querySelectorAll<HTMLElement>(LIST)) {
    if (list.parentElement?.closest(LIST)) continue;
    const scroller = scrollParent(list);
    const firstRow = list.querySelector<HTMLElement>(ROW);
    const threadId = firstRow ? threadIdOf(firstRow.dataset.timelineRowId ?? "") : null;
    if (scroller && threadId) views.push({ threadId, list, scroller });
  }
  return views;
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
  }
  return null;
}

/** The view's top-level rendered rows, sorted top to bottom. */
export function rowBoxes(view: ChatView): RowBox[] {
  const boxes: RowBox[] = [];
  for (const row of view.list.querySelectorAll<HTMLElement>(ROW)) {
    if (row.parentElement?.closest(LIST) !== view.list) continue;
    const { top, bottom } = row.getBoundingClientRect();
    boxes.push({ id: row.dataset.timelineRowId!, top, bottom });
  }
  return boxes.sort((a, b) => a.top - b.top);
}

function findRow(view: ChatView, rowId: string): HTMLElement | null {
  return view.list.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(rowId)}"]`);
}

export function rowText(view: ChatView, rowId: string): string | null {
  const text = findRow(view, rowId)?.innerText;
  return text ? oneLine(text) : null;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Scroll until the row sits at the top of the view. bb only renders rows near
 * the viewport, so an unrendered row is approached by estimate first.
 */
export async function scrollToRow(
  view: ChatView,
  rowId: string,
  target: number | null,
  positions: ReadonlyMap<string, number>,
): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const edge = view.scroller.getBoundingClientRect().top;
    const row = findRow(view, rowId);
    if (row) {
      const delta = row.getBoundingClientRect().top - edge - GAP;
      if (Math.abs(delta) < 2) return;
      view.scroller.scrollTop += delta;
    } else {
      if (target === null || positions.size === 0) return;
      const near = rowBoxes(view)
        .map((box) => ({ box, position: positions.get(box.id) }))
        .filter((entry): entry is { box: RowBox; position: number } => entry.position !== undefined)
        .sort((a, b) => Math.abs(a.position - target) - Math.abs(b.position - target))[0];
      if (!near) return;
      const rowHeight = view.list.getBoundingClientRect().height / positions.size;
      view.scroller.scrollTop += near.box.top - edge + (target - near.position) * rowHeight;
    }
    await nextFrame();
    await nextFrame();
  }
}
