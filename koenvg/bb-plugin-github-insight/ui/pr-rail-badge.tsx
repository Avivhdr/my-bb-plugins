import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { reviewBadge } from "../core/review-badge";
import { useReviewQueue } from "./use-review-queue";

const RAIL_ITEM = '[data-nav-rail-item="github-insight/pull-requests"]';
const CUTOUT = { boxShadow: "0 0 0 2px var(--surface-recessed-solid)" };

export function PrRailBadge() {
  const item = useHostElement(RAIL_ITEM);
  const badge = reviewBadge(useReviewQueue().view);
  if (item === null || badge === null) return null;
  const loud = badge.unseen || badge.returned;
  return createPortal(
    // Plugin CSS only applies inside an element tagged with the plugin id.
    <span data-bb-plugin="github-insight" className="pointer-events-none relative w-0 self-stretch">
      <span className="absolute inset-y-0 right-0 aspect-square">
        {badge.count === null ? (
          <span
            role="img"
            aria-label="Review agent came back"
            style={CUTOUT}
            className="absolute left-1/2 top-1/2 -mt-2.5 ml-1 size-2 rounded-full bg-primary"
          />
        ) : (
          <span
            data-testid="rail-review-count"
            style={CUTOUT}
            className={`absolute left-1/2 top-1/2 -mt-3.5 ml-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-[3px] text-[9px] font-semibold leading-none tabular-nums ${
              loud ? "bg-primary text-primary-foreground" : "bg-muted-foreground text-background"
            }`}
          >
            {badge.count}
            <span className="sr-only">
              {badge.count === "1" ? " pull request needs review" : " pull requests need review"}
              {badge.unseen && ", new"}
              {badge.returned && ", review agent came back"}
            </span>
          </span>
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
