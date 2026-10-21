import { useState, type DragEvent } from "react";
import { flattenCards, type BoardCard, type BoardColumn } from "../core/board";
import type { SearchTerms } from "../core/search";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ColorGrid, swatchStyle, tintStyle } from "./bits";
import { Card, type IssueActions } from "./Card";

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

/**
 * The board: one tray per curated label plus "No label / Other". Trays pack into as
 * many ~300px tracks as fit and stack downward, so the page scrolls vertically only.
 * Dragging a card to another tray swaps that label for the target's.
 */
export function Board({
  columns,
  terms,
  actions,
  onCardClick,
  onAddCard,
  onMoveCard,
  onRecolor,
}: {
  columns: BoardColumn[];
  terms: SearchTerms;
  actions: IssueActions;
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
    <div className="columns-[300px] gap-3 p-4">
      {columns.map((column) => {
        const count = flattenCards(column.cards).length;
        const addLabel = column.isOther ? "Create issue with no label" : `Create issue in ${column.title}`;
        return (
          <section
            key={column.label || "other"}
            aria-label={column.title}
            className="mb-3 inline-flex w-full break-inside-avoid flex-col rounded-lg border border-border bg-card align-top"
            style={tintStyle(column.color, { fill: 0.12, border: 0.3 })}
          >
            <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
              {column.isOther ? null : <ColumnColor column={column} onRecolor={onRecolor} />}
              <span className="truncate text-sm font-semibold text-foreground">{column.title}</span>
              <span className="ml-auto shrink-0 rounded-md bg-background/60 px-1.5 text-xs tabular-nums text-muted-foreground">
                {count}
              </span>
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
            <div
              className={cn(
                "flex flex-col gap-2 rounded-lg p-2 transition-colors",
                dragOverLabel === column.label && "bg-primary/10 outline-2 outline-dashed outline-primary",
              )}
              onDragOver={(event) => handleDragOver(event, column)}
              onDragLeave={() => {
                if (dragOverLabel === column.label) setDragOverLabel(null);
              }}
              onDrop={(event) => handleDrop(event, column)}
            >
              {column.cards.map((card) => (
                <div
                  key={card.issueNumber}
                  draggable={!actions.busy}
                  className={cn(
                    "flex cursor-grab flex-col active:cursor-grabbing",
                    dragged?.issueNumber === card.issueNumber && "opacity-40",
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
          </section>
        );
      })}
    </div>
  );
}
