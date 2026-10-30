import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reviewBadge } from "../core/review-badge";
import { useReviewQueue } from "./use-review-queue";

const RAIL_ITEM = '[data-nav-rail-item="github-insight/pull-requests"]';
const CUTOUT = { boxShadow: "0 0 0 2px var(--surface-recessed-solid)" };

const PILL =
  "absolute top-1/2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-[3px] text-[9px] font-semibold leading-none tabular-nums text-white";

export function PrRailBadge() {
  const item = useHostElement(RAIL_ITEM);
  const badge = reviewBadge(useReviewQueue().view);
  if (item === null || badge === null) return null;
  const { inProgress, ready } = badge;
  const anyCount = badge.waiting !== null || inProgress > 0 || ready > 0;
  return createPortal(
    // Plugin CSS only applies inside an element tagged with the plugin id.
    <span data-bb-plugin="github-insight" className="pointer-events-none relative w-0 self-stretch">
      <span className="absolute inset-y-0 right-0 aspect-square">
        {badge.waiting !== null && (
          <span
            data-testid="rail-review-count"
            style={CUTOUT}
            className={`${PILL} left-1/2 -mt-3.5 ml-0.5 bg-red-600`}
          >
            {badge.waiting}
            <span className="sr-only">
              {badge.waiting === "1" ? " pull request needs review" : " pull requests need review"}
              {badge.unseen && ", new"}
            </span>
          </span>
        )}
        {inProgress > 0 && (
          <span
            data-testid="rail-in-progress-count"
            style={CUTOUT}
            className={`${PILL} right-1/2 -mt-3.5 mr-0.5 bg-orange-500`}
          >
            {inProgress}
            <span className="sr-only">
              {inProgress === 1 ? " review in progress" : " reviews in progress"}
            </span>
          </span>
        )}
        {ready > 0 && (
          <span
            data-testid="rail-ready-count"
            style={CUTOUT}
            className={`${PILL} left-1/2 mt-1 ml-0.5 bg-green-600`}
          >
            {ready}
            <span className="sr-only">
              {ready === 1 ? " review ready for you" : " reviews ready for you"}
            </span>
          </span>
        )}
        {badge.returned && !anyCount && (
          <span
            role="img"
            aria-label="Review agent came back"
            style={CUTOUT}
            className="absolute left-1/2 top-1/2 -mt-2.5 ml-1 size-2 rounded-full bg-primary"
          />
        )}
      </span>
    </span>,
    item,
  );
}

function useHostElement(selector: string): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    let current: HTMLElement | null = null;
    const find = () => {
      if (current?.isConnected) return;
      current = document.querySelector<HTMLElement>(selector);
      setElement(current);
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selector]);
  return element;
}
