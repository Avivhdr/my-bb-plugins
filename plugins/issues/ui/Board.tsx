import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type SyntheticEvent } from "react";
import { flattenCards, type BoardCard, type BoardColumn } from "../core/board";
import {
  dependencyEdges,
  measureBoardArrows,
  peerIssueNumbers,
  type DrawnDependencyArrow,
} from "../core/dependencyArrows";
import { countColumnResults, type SearchTerms } from "../core/search";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ColorGrid, swatchStyle, tintStyle } from "./bits";
import { Card, type IssueActions } from "./Card";
import { DependencyFocusContext, HIGHLIGHT_CLASS, type DependencyFocus } from "./dependencyFocus";

interface DraggedCard {
  issueNumber: number;
  fromLabel: string;
}

function ColumnColor({
  column,
  onRecolor,
}: {
  column: BoardColumn;
  onRecolor: (label: string, color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="size-3.5 shrink-0 rounded-md border border-foreground/20 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={swatchStyle(column.color)}
          aria-label={`Change color of ${column.title}`}
          title={`Change "${column.title}" color`}
        />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2" mobileTitle={`${column.title} color`}>
        <ColorGrid
          current={column.color}
          onPick={(color) => {
            setOpen(false);
            onRecolor(column.label, color);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function issueNumberFromTarget(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest("[data-issue-number]");
  if (!(node instanceof HTMLElement)) return null;
  const issueNumber = Number(node.dataset.issueNumber);
  return Number.isInteger(issueNumber) ? issueNumber : null;
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Arrows from each blocking issue to the issue it blocks, drawn over the trays. Both
 * ends must be cards on the board. The paths come from measured card boxes, so they
 * are re-measured whenever the layout can move.
 */
function DependencyArrows({ arrows, focusedIssue }: { arrows: DrawnDependencyArrow[]; focusedIssue: number | null }) {
  const markerId = `issues-dep-arrow-${useId().replace(/:/g, "")}`;
  if (arrows.length === 0) return null;
  return (
    <svg
      aria-hidden
      data-testid="dependency-arrows"
      className="pointer-events-none absolute inset-0 z-[3] size-full overflow-visible"
      style={{ color: "color-mix(in srgb, var(--warning) 48%, var(--foreground))" }}
    >
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M 0 1.2 L 9 5 L 0 8.8 Z" fill="currentColor" />
        </marker>
      </defs>
      {arrows.map((arrow) => {
        const active = focusedIssue !== null && (arrow.blocker === focusedIssue || arrow.blocked === focusedIssue);
        // Hovering an issue dims every arrow but its own.
        const opacity = focusedIssue === null ? 0.55 : active ? 1 : 0.14;
        return (
          <path
            key={`${arrow.blocker}->${arrow.blocked}`}
            d={arrow.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={active ? 2.25 : 1.75}
            strokeLinecap="round"
            markerEnd={`url(#${markerId})`}
            className="transition-opacity duration-150 motion-reduce:transition-none"
            style={{ opacity }}
          />
        );
      })}
    </svg>
  );
}

function ColumnCount({ count }: { count: number }) {
  return (
    <span
      className="shrink-0 rounded-md bg-background/60 px-1.5 text-xs tabular-nums text-muted-foreground"
      title={count === 1 ? "1 issue" : `${count} issues`}
    >
      {count}
    </span>
  );
}

/**
 * The board: one tray per curated label plus "No label / Other". Trays pack into as
 * many ~300px tracks as fit and stack downward, so the page scrolls vertically only.
 * Dragging a card to another tray swaps that label for the target's.
 */
export function Board({
  columns,
  terms,
  actions,
  collapsedLabels,
  isResult,
  onToggleCollapsed,
  onCardClick,
  onAddCard,
  onMoveCard,
  onRecolor,
}: {
  columns: BoardColumn[];
  terms: SearchTerms;
  actions: IssueActions;
  /** Labels of the trays that show only their header. */
  collapsedLabels: ReadonlySet<string>;
  /**
   * Whether a card is a filter result, not only context around one. A tray's count
   * includes only these cards, so it shows the filtered total even while collapsed.
   */
  isResult: (card: BoardCard) => boolean;
  onToggleCollapsed: (label: string) => void;
  onCardClick: (card: BoardCard, column: BoardColumn) => void;
  onAddCard: (label: string) => void;
  onMoveCard: (issueNumber: number, fromLabel: string, toLabel: string) => void;
  onRecolor: (label: string, color: string) => void;
}) {
  const [dragged, setDragged] = useState<DraggedCard | null>(null);
  const [dragOverLabel, setDragOverLabel] = useState<string | null>(null);
  // Sub-issue trees start collapsed so a parent with many children does not fill the
  // tray. Search expands every node so a match in a nested card is visible.
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const searching = terms.length > 0;
  const isExpanded = (issueNumber: number) => searching || expanded.has(issueNumber);
  const toggleExpanded = (issueNumber: number) => {
    if (searching) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(issueNumber)) next.delete(issueNumber);
      else next.add(issueNumber);
      return next;
    });
  };

  const wrapRef = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<DrawnDependencyArrow[]>([]);
  const [focusedIssue, setFocusedIssue] = useState<number | null>(null);
  const repo = actions.repo;

  const edges = useMemo(() => {
    const cards = columns.flatMap((column) => column.cards);
    const onBoard = new Set(flattenCards(cards).map((card) => card.issueNumber));
    return dependencyEdges(cards, repo, onBoard);
  }, [columns, repo]);

  const peers = useMemo(
    () => (focusedIssue === null ? new Set<number>() : new Set(peerIssueNumbers(edges, focusedIssue))),
    [edges, focusedIssue],
  );

  const reveal = useCallback((issueNumber: number): boolean => {
    const node = wrapRef.current?.querySelector(`[data-issue-number="${issueNumber}"]`);
    if (!(node instanceof HTMLElement)) return false;
    try {
      node.scrollIntoView({ block: "nearest", inline: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    } catch {
      // Some hosts reject the options object. The highlight still shows the card.
    }
    setFocusedIssue(issueNumber);
    return true;
  }, []);

  const focus = useMemo<DependencyFocus>(
    () => ({
      isHighlighted: (issueNumber) => issueNumber === focusedIssue || peers.has(issueNumber),
      reveal,
    }),
    [focusedIssue, peers, reveal],
  );

  // Re-measure when the trays change, a sub-issue tree opens, or a tray collapses.
  // The observer covers everything else that moves cards: a window resize, or a
  // track wrapping to a new line.
  useLayoutEffect(() => {
    const node = wrapRef.current;
    if (!node || edges.length === 0) {
      setArrows((current) => (current.length === 0 ? current : []));
      return;
    }
    const measure = () => setArrows(measureBoardArrows(node, columns, repo));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [columns, repo, edges, expanded, collapsedLabels]);

  function trackPointer(event: SyntheticEvent) {
    const issueNumber = issueNumberFromTarget(event.target);
    if (issueNumber !== null) setFocusedIssue(issueNumber);
  }

  function clearPointer(event: SyntheticEvent & { relatedTarget: EventTarget | null }) {
    const next = event.relatedTarget;
    if (next instanceof Node && wrapRef.current?.contains(next)) return;
    setFocusedIssue(null);
  }

  function handleDragStart(event: DragEvent, card: BoardCard, column: BoardColumn) {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-sub-issue-row], button")) {
      event.preventDefault();
      return;
    }
    setDragged({ issueNumber: card.issueNumber, fromLabel: column.label });
    event.dataTransfer.setData("text/plain", String(card.issueNumber));
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd() {
    setDragged(null);
    setDragOverLabel(null);
  }

  // Only a tray other than the card's own accepts the drop; preventDefault is what
  // tells the browser this is a valid target.
  function handleDragOver(event: DragEvent, column: BoardColumn) {
    if (!dragged || dragged.fromLabel === column.label) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverLabel(column.label);
  }

  function handleDrop(event: DragEvent, column: BoardColumn) {
    event.preventDefault();
    const card = dragged;
    setDragged(null);
    setDragOverLabel(null);
    if (!card || card.fromLabel === column.label) return;
    onMoveCard(card.issueNumber, card.fromLabel, column.label);
  }

  return (
    <DependencyFocusContext.Provider value={focus}>
      {/* The arrow layer is a sibling of the tray layout: a child of the CSS columns
          container would be packed into one of the columns. Hover and focus only
          highlight dependencies, so this wrapper is not a control. */}
      <div
        ref={wrapRef}
        className="relative"
        onMouseOver={trackPointer}
        onMouseLeave={clearPointer}
        onFocus={trackPointer}
        onBlur={clearPointer}
      >
        <div className="columns-[300px] gap-3 p-4">
          {columns.map((column) => {
            const collapsed = collapsedLabels.has(column.label);
            const count = countColumnResults(column.cards, isResult);
            const addLabel = column.isOther ? "Create issue with no label" : `Create issue in ${column.title}`;
            const isDropTarget = dragOverLabel === column.label;
            return (
              // The whole tray takes a dropped card, so a collapsed tray takes it on its header.
              <section
                key={column.label || "other"}
                aria-label={column.title}
                className="mb-3 inline-flex w-full break-inside-avoid flex-col rounded-lg border border-border bg-card align-top"
                style={tintStyle(column.color, { fill: 0.12, border: 0.3 })}
                onDragOver={(event) => handleDragOver(event, column)}
                onDragLeave={() => {
                  if (dragOverLabel === column.label) setDragOverLabel(null);
                }}
                onDrop={(event) => handleDrop(event, column)}
              >
                <div
                  className={cn(
                    "flex items-center gap-2 py-2 pl-1.5 pr-3 transition-colors",
                    collapsed
                      ? cn("rounded-lg", isDropTarget && "bg-primary/10 outline-2 outline-dashed outline-primary")
                      : "border-b border-border/60",
                  )}
                >
                  <button
                    type="button"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? `Expand ${column.title}` : `Collapse ${column.title}`}
                    title={collapsed ? `Expand "${column.title}"` : `Collapse "${column.title}"`}
                    onClick={() => onToggleCollapsed(column.label)}
                  >
                    <Icon
                      name="ChevronRight"
                      className={cn("size-3.5 transition-transform motion-reduce:transition-none", !collapsed && "rotate-90")}
                    />
                  </button>
                  {column.isOther ? null : <ColumnColor column={column} onRecolor={onRecolor} />}
                  <span className="truncate text-sm font-semibold text-foreground">{column.title}</span>
                  <span className="ml-auto" />
                  <ColumnCount count={count} />
                  <button
                    type="button"
                    className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
                    aria-label={addLabel}
                    title={addLabel}
                    disabled={actions.busy}
                    onClick={() => onAddCard(column.label)}
                  >
                    <Icon name="Plus" className="size-3.5" />
                  </button>
                </div>
                {collapsed ? null : (
                  <div
                    className={cn(
                      "flex flex-col gap-2 rounded-lg p-2 transition-colors",
                      isDropTarget && "bg-primary/10 outline-2 outline-dashed outline-primary",
                    )}
                  >
                    {column.cards.map((card) => (
                      <div
                        key={card.issueNumber}
                        draggable={!actions.busy}
                        data-issue-number={card.issueNumber}
                        className={cn(
                          "flex cursor-grab flex-col rounded-lg active:cursor-grabbing",
                          dragged?.issueNumber === card.issueNumber && "opacity-40",
                          focus.isHighlighted(card.issueNumber) && HIGHLIGHT_CLASS,
                        )}
                        onDragStart={(event) => handleDragStart(event, card, column)}
                        onDragEnd={handleDragEnd}
                      >
                        <Card
                          card={card}
                          terms={terms}
                          expanded={isExpanded(card.issueNumber)}
                          isExpanded={isExpanded}
                          onToggleExpand={toggleExpanded}
                          onOpen={() => onCardClick(card, column)}
                          onOpenChild={(child) => onCardClick(child, column)}
                          actions={actions}
                        />
                      </div>
                    ))}
                    {column.cards.length === 0 ? (
                      <p className="m-0 py-4 text-center text-xs text-muted-foreground">No issues</p>
                    ) : null}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <DependencyArrows arrows={arrows} focusedIssue={focusedIssue} />
      </div>
    </DependencyFocusContext.Provider>
  );
}
