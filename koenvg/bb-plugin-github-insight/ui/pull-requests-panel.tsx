import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { PluginNavPanelProps } from "@get-bb/plugin-sdk/app";
import type { PullRequestRef } from "../core/pr-ref";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { PrOverview } from "./overview-tab";
import {
  LIST_ROUTE,
  parsePullRequestsRoute,
  pullRequestsRouteToSubPath,
  usePullRequestsNavigation,
} from "./pull-requests-routes";
import { ICON_ACTION_CLASS } from "./queue-styles";
import { ReviewComposerPage } from "./review-composer";
import { ReviewQueueLists } from "./review-queue-list";
import { usePrInsight } from "./use-pr-insight";
import { useReviewQueue } from "./use-review-queue";
import { OVERVIEW_WIDTH, useOverviewLayout } from "./use-overview-layout";

type OverviewLayoutControls = ReturnType<typeof useOverviewLayout>;

export function PullRequestsPanel({ subPath }: PluginNavPanelProps) {
  const queue = useReviewQueue();
  const overview = useOverviewLayout();
  const route = parsePullRequestsRoute(subPath);
  if (route.kind === "review") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
        <ReviewComposerPage key={pullRequestsRouteToSubPath(route)} route={route} queue={queue} />
      </div>
    );
  }
  const { selected } = route;
  const overviewFillsPanel = selected !== null && overview.layout.maximized;
  return (
    <div className="@container flex h-full min-h-0">
      <div
        hidden={overviewFillsPanel}
        className={cn(
          "min-h-0 min-w-0 flex-1 overflow-y-auto p-4",
          selected !== null && "hidden",
          selected !== null && !overviewFillsPanel && "@3xl:block",
        )}
      >
        <ReviewQueueLists queue={queue} selected={selected} />
      </div>
      {selected !== null && (
        <PrSidePanel key={pullRequestsRouteToSubPath(route)} pr={selected} overview={overview} />
      )}
    </div>
  );
}

function PrSidePanel({ pr, overview }: { pr: PullRequestRef; overview: OverviewLayoutControls }) {
  const navigation = usePullRequestsNavigation();
  const insight = usePrInsight(pr);
  const { maximized } = overview.layout;
  return (
    <aside
      aria-label="Pull request overview"
      className={cn(
        "relative flex min-h-0 w-full min-w-0 shrink-0 flex-col border-border",
        !maximized && "@3xl:w-[var(--overview-width)] @3xl:max-w-[calc(100%-360px)] @3xl:border-l",
      )}
      style={{ "--overview-width": `${overview.layout.width}px` } as CSSProperties}
    >
      {!maximized && <ResizeHandle overview={overview} />}
      <header className="flex min-w-0 items-center gap-2 border-b border-border py-1 pr-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-muted-foreground">
          {pr.owner}/{pr.repo}
        </span>
        <button
          type="button"
          aria-label={maximized ? "Restore overview" : "Maximize overview"}
          className={cn(ICON_ACTION_CLASS, "hidden @3xl:inline-flex")}
          onClick={overview.toggleMaximized}
        >
          <Icon name={maximized ? "Minimize2" : "Maximize2"} className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Close overview"
          className={ICON_ACTION_CLASS}
          onClick={() => navigation.go(LIST_ROUTE)}
        >
          <Icon name="X" className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <PrOverview insight={insight} noPrText="Pull request not found" controls={null} />
      </div>
    </aside>
  );
}

function ResizeHandle({ overview }: { overview: OverviewLayoutControls }) {
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startWidth = renderedWidth(event.currentTarget);
    drag.current = { startX: event.clientX, startWidth, width: startWidth };
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    drag.current.width = drag.current.startWidth - (event.clientX - drag.current.startX);
    overview.previewWidth(drag.current.width);
  }

  function endDrag() {
    if (drag.current === null) return;
    overview.commitWidth(drag.current.width);
    drag.current = null;
    setDragging(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowLeft" ? 10 : event.key === "ArrowRight" ? -10 : 0;
    if (step === 0) return;
    event.preventDefault();
    overview.commitWidth(renderedWidth(event.currentTarget) + step);
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize overview"
      aria-valuemin={OVERVIEW_WIDTH.min}
      aria-valuemax={OVERVIEW_WIDTH.max}
      aria-valuenow={overview.layout.width}
      tabIndex={0}
      data-dragging={dragging}
      className="absolute inset-y-0 -left-0.5 z-10 hidden w-1 cursor-col-resize touch-none transition-colors duration-150 hover:bg-ring/40 focus-visible:bg-ring/60 focus-visible:outline-none data-[dragging=true]:bg-ring/60 motion-reduce:transition-none @3xl:block"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={overview.resetWidth}
      onKeyDown={onKeyDown}
    />
  );
}

function renderedWidth(handle: HTMLElement): number {
  return handle.parentElement!.getBoundingClientRect().width;
}
