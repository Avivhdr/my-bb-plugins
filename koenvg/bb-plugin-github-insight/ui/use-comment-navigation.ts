import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { offsetFromTop, pinToTop, type PinTarget } from "../../review-ui/pin-to-top";
import { stickyHeaderHeight } from "../../review-ui/review-file-diff";
import type { CommentStop } from "../core/comment-stops";
import type { JumpMark } from "./jump-highlight";

const TOP_TOLERANCE_PX = 1;
const CARD_GAP_PX = 8;

export type StepDirection = 1 | -1;

export interface CommentNavigation {
  position: number | null;
  total: number;
  jumpMark: JumpMark | null;
  step(direction: StepDirection): void;
  jumpToFirstThread(threadIds: ReadonlySet<string>): void;
}

interface Pin {
  stop: CommentStop;
  release: () => void;
}

export function useCommentNavigation(
  scrollArea: RefObject<HTMLElement | null>,
  content: RefObject<HTMLElement | null>,
  stops: readonly CommentStop[],
): CommentNavigation {
  const [current, setCurrent] = useState(0);
  const [jumpMark, setJumpMark] = useState<JumpMark | null>(null);
  const pin = useRef<Pin | null>(null);

  const pinnedIndex = useCallback((): number | null => {
    if (pin.current === null) return null;
    const index = indexOf(stops, pin.current.stop);
    if (index === -1) pin.current.release();
    return index === -1 ? null : index;
  }, [stops]);

  const updateCurrent = useCallback(() => {
    const area = scrollArea.current;
    if (area === null || stops.length === 0) return;
    setCurrent(pinnedIndex() ?? currentIndex(area, stops));
  }, [scrollArea, stops, pinnedIndex]);

  useEffect(() => {
    const area = scrollArea.current;
    if (area === null) return;
    updateCurrent();
    let frame: number | null = null;
    const schedule = () => {
      if (frame !== null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        updateCurrent();
      });
    };
    area.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    if (content.current !== null) observer.observe(content.current);
    return () => {
      area.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [scrollArea, content, updateCurrent]);

  useEffect(() => () => pin.current?.release(), []);

  const jumpTo = useCallback(
    (index: number) => {
      const area = scrollArea.current;
      if (area === null) return;
      const stop = stops[index]!;
      pin.current?.release();
      const entry: Pin = { stop, release: () => {} };
      pin.current = entry;
      setCurrent(index);
      setJumpMark((mark) => ({ stop, token: (mark?.token ?? 0) + 1 }));
      entry.release = pinToTop(
        area,
        content.current,
        () => locate(area, stop),
        () => {
          if (pin.current === entry) pin.current = null;
        },
      );
    },
    [scrollArea, content, stops],
  );

  const step = useCallback(
    (direction: StepDirection) => {
      const area = scrollArea.current;
      if (area === null || stops.length === 0) return;
      jumpTo(wrap(targetIndex(area, stops, pinnedIndex(), direction), stops.length));
    },
    [scrollArea, stops, pinnedIndex, jumpTo],
  );

  const jumpToFirstThread = useCallback(
    (threadIds: ReadonlySet<string>) => {
      const index = stops.findIndex(({ kind, id }) => kind === "thread" && threadIds.has(id));
      if (index !== -1) jumpTo(index);
    },
    [stops, jumpTo],
  );

  return {
    position: stops.length === 0 ? null : Math.min(current, stops.length - 1),
    total: stops.length,
    jumpMark,
    step,
    jumpToFirstThread,
  };
}

function targetIndex(
  area: HTMLElement,
  stops: readonly CommentStop[],
  pinnedIndex: number | null,
  direction: StepDirection,
): number {
  if (pinnedIndex !== null) return pinnedIndex + direction;
  const current = currentIndex(area, stops);
  const place = locate(area, stops[current]!);
  const offset = place === null ? 0 : offsetFromTop(area, place);
  if (direction === 1) {
    const insideUnloadedFile = place?.isCard === false && offset >= -TOP_TOLERANCE_PX;
    return offset > TOP_TOLERANCE_PX || insideUnloadedFile ? current : current + 1;
  }
  return offset < -TOP_TOLERANCE_PX ? current : current - 1;
}

function currentIndex(area: HTMLElement, stops: readonly CommentStop[]): number {
  const index = stops.findIndex((stop) => {
    const place = locate(area, stop);
    return place !== null && offsetFromTop(area, place) >= -TOP_TOLERANCE_PX;
  });
  return index === -1 ? stops.length - 1 : index;
}

function locate(area: HTMLElement, stop: CommentStop): (PinTarget & { isCard: boolean }) | null {
  const card = area.querySelector<HTMLElement>(
    `[${CARD_ATTRIBUTE[stop.kind]}="${CSS.escape(stop.id)}"]`,
  );
  if (card !== null) {
    return { element: card, inset: stickyHeaderHeight(card) + CARD_GAP_PX, isCard: true };
  }
  if (stop.filePath === null) return null;
  const section = area.querySelector<HTMLElement>(
    `section[data-path="${CSS.escape(stop.filePath)}"]`,
  );
  return section === null ? null : { element: section, inset: 0, isCard: false };
}

function indexOf(stops: readonly CommentStop[], stop: CommentStop): number {
  return stops.findIndex(({ kind, id }) => kind === stop.kind && id === stop.id);
}

const CARD_ATTRIBUTE: Record<CommentStop["kind"], string> = {
  thread: "data-review-thread-id",
  draft: "data-comment-draft-id",
};

function wrap(index: number, length: number): number {
  return ((index % length) + length) % length;
}
