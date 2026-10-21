import { useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import type { BoardCard } from "../core/board";
import { cardIsBlocked } from "../core/dependency";
import { issueUrl } from "../core/issueThread";
import { cardExcerpt, type SearchTerms } from "../core/search";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { HighlightedText, LinkedPullRequestLinks, MetaChip, ValueGrid, valueBadgeStyle } from "./bits";
import { DependencyMarks } from "./DependencyMarks";
import { HIGHLIGHT_CLASS, useDependencyFocus } from "./dependencyFocus";

/** Everything a card can ask the page to do with an issue. */
export interface IssueActions {
  repo: string;
  busy: boolean;
  onOpenUrl: (url: string) => void;
  onCopyLink: (issueNumber: number) => void;
  onSetValue: (issueNumber: number, value: number | null) => void;
  onOpenThread: (threadId: string) => void;
  onStartThread: (card: BoardCard) => void;
  onDraftThread: (card: BoardCard) => void;
}

type MenuItem = ComponentType<{ onSelect?: () => void; disabled?: boolean; children?: ReactNode }>;
type MenuSeparator = ComponentType<object>;

/** The same issue actions in the card's ⋯ menu and its right-click menu. */
function IssueActionItems({
  card,
  actions,
  Item,
  Separator,
}: {
  card: BoardCard;
  actions: IssueActions;
  Item: MenuItem;
  Separator: MenuSeparator;
}) {
  const threadId = card.threadLink?.threadId ?? null;
  return (
    <>
      {threadId ? (
        <Item onSelect={() => actions.onOpenThread(threadId)}>Open linked thread</Item>
      ) : null}
      <Item disabled={actions.busy} onSelect={() => actions.onStartThread(card)}>
        {threadId ? "Start another thread" : "Start thread"}
      </Item>
      <Item onSelect={() => actions.onDraftThread(card)}>Draft in new thread…</Item>
      <Separator />
      <Item onSelect={() => actions.onOpenUrl(issueUrl(actions.repo, card.issueNumber))}>Open on GitHub</Item>
      <Item onSelect={() => actions.onCopyLink(card.issueNumber)}>Copy link</Item>
    </>
  );
}

export function IssueContextMenu({
  card,
  actions,
  children,
}: {
  card: BoardCard;
  actions: IssueActions;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-48">
        <IssueActionItems card={card} actions={actions} Item={ContextMenuItem} Separator={ContextMenuSeparator} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function activateOnKey(event: KeyboardEvent, activate: () => void) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

function SubIssueToggle({
  issue,
  expanded,
  onToggle,
  withCount,
}: {
  issue: BoardCard;
  expanded: boolean;
  onToggle: () => void;
  withCount?: boolean;
}) {
  const count = issue.subIssues.length;
  const noun = count === 1 ? "sub-issue" : "sub-issues";
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Hide" : "Show"} ${count} ${noun} of #${issue.issueNumber}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        withCount ? "h-6 self-start px-1" : "mt-1 size-5 justify-center",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <Icon name={expanded ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
      {withCount ? (
        <span>
          {count} {noun}
        </span>
      ) : null}
    </button>
  );
}

function SubIssueList({
  issues,
  parentNumber,
  terms,
  isExpanded,
  onToggleExpand,
  onOpen,
  actions,
}: {
  issues: BoardCard[];
  parentNumber: number;
  terms: SearchTerms;
  isExpanded: (issueNumber: number) => boolean;
  onToggleExpand: (issueNumber: number) => void;
  onOpen: (card: BoardCard) => void;
  actions: IssueActions;
}) {
  const focus = useDependencyFocus();
  return (
    <ul
      aria-label={`Sub-issues of #${parentNumber}`}
      className="m-0 flex list-none flex-col gap-0.5 border-l border-border py-0.5 pl-2"
    >
      {issues.map((issue) => {
        const excerpt = cardExcerpt(issue, terms);
        const expanded = isExpanded(issue.issueNumber);
        const blocked = cardIsBlocked(issue);
        return (
          <li key={issue.issueNumber} className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-start gap-0.5">
              {issue.subIssues.length > 0 ? (
                <SubIssueToggle
                  issue={issue}
                  expanded={expanded}
                  onToggle={() => onToggleExpand(issue.issueNumber)}
                />
              ) : (
                <span className="mt-1 size-5 shrink-0" aria-hidden />
              )}
              <IssueContextMenu card={issue} actions={actions}>
                <div
                  role="button"
                  tabIndex={0}
                  data-sub-issue-row=""
                  data-issue-number={issue.issueNumber}
                  aria-label={`Issue #${issue.issueNumber}: ${issue.title}`}
                  className={cn(
                    "flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 rounded-md px-1.5 py-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    // A blocked row is gray; an unblocked row stays bright inside a gray parent.
                    blocked ? "bg-muted text-muted-foreground hover:bg-state-hover" : "bg-background hover:bg-state-hover",
                    focus.isHighlighted(issue.issueNumber) && HIGHLIGHT_CLASS,
                  )}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(issue);
                  }}
                  onKeyDown={(event) => activateOnKey(event, () => onOpen(issue))}
                >
                  <div className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 text-xs text-muted-foreground">#{issue.issueNumber}</span>
                    <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">
                      <HighlightedText text={issue.title} terms={terms} />
                    </span>
                    {issue.subIssuesSummary ? (
                      <span
                        className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                        aria-label={`${issue.subIssuesSummary.completed} of ${issue.subIssuesSummary.total} sub-issues complete`}
                      >
                        {issue.subIssuesSummary.completed}/{issue.subIssuesSummary.total}
                      </span>
                    ) : null}
                    <LinkedPullRequestLinks pullRequests={issue.linkedPullRequests} onOpenUrl={actions.onOpenUrl} />
                  </div>
                  {issue.blockedByOpenCount > 0 || issue.blockingOpenCount > 0 ? (
                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      <DependencyMarks
                        card={issue}
                        repo={actions.repo}
                        onOpenUrl={actions.onOpenUrl}
                        onRevealIssue={focus.reveal}
                      />
                    </div>
                  ) : null}
                  {excerpt ? (
                    <p className="m-0 text-[11px] leading-snug text-muted-foreground">
                      <HighlightedText text={excerpt} terms={terms} />
                    </p>
                  ) : null}
                </div>
              </IssueContextMenu>
            </div>
            {issue.subIssues.length > 0 && expanded ? (
              <SubIssueList
                issues={issue.subIssues}
                parentNumber={issue.issueNumber}
                terms={terms}
                isExpanded={isExpanded}
                onToggleExpand={onToggleExpand}
                onOpen={onOpen}
                actions={actions}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function ValueBadge({
  card,
  onSetValue,
}: {
  card: BoardCard;
  onSetValue: (issueNumber: number, value: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const label = card.value !== null ? `Value: ${card.value}. Click to change.` : "Set value";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={label}
          aria-label={label}
          className={cn(
            "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border px-1.5 text-xs font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            card.value === null && "border-border bg-card text-muted-foreground opacity-70 hover:opacity-100",
          )}
          style={card.value !== null ? valueBadgeStyle(card.value) : undefined}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {card.value ?? "+"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-2" mobileTitle="Set value" onClick={(event) => event.stopPropagation()}>
        <ValueGrid
          current={card.value}
          onPick={(value) => {
            setOpen(false);
            onSetValue(card.issueNumber, value);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function Card({
  card,
  terms,
  expanded,
  isExpanded,
  onToggleExpand,
  onOpen,
  onOpenChild,
  actions,
}: {
  card: BoardCard;
  terms: SearchTerms;
  expanded: boolean;
  isExpanded: (issueNumber: number) => boolean;
  onToggleExpand: (issueNumber: number) => void;
  onOpen: () => void;
  onOpenChild: (card: BoardCard) => void;
  actions: IssueActions;
}) {
  const excerpt = cardExcerpt(card, terms);
  const threadLink = card.threadLink;
  const focus = useDependencyFocus();
  // A blocked issue waits on others. The gray surface marks that end of an arrow.
  const blocked = cardIsBlocked(card);

  return (
    <IssueContextMenu card={card} actions={actions}>
      <article
        className={cn(
          "flex flex-col gap-2 rounded-lg border p-3 transition-colors",
          blocked
            ? "border-foreground/15 bg-muted hover:border-foreground/30"
            : "border-border bg-background shadow-xs hover:border-foreground/30",
        )}
      >
        <div
          role="button"
          tabIndex={0}
          className="flex min-w-0 cursor-pointer flex-col gap-2 focus-visible:outline-none"
          onClick={onOpen}
          onKeyDown={(event) => activateOnKey(event, onOpen)}
        >
          <div className="flex items-start gap-2">
            <span
              className={cn(
                "min-w-0 flex-1 break-words text-sm font-medium",
                blocked ? "text-muted-foreground" : "text-foreground",
              )}
            >
              <HighlightedText text={card.title} terms={terms} />
            </span>
            <ValueBadge card={card} onSetValue={actions.onSetValue} />
          </div>
          {excerpt ? (
            <p className="m-0 break-words text-xs text-muted-foreground">
              <HighlightedText text={excerpt} terms={terms} />
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">#{card.issueNumber}</span>
            <DependencyMarks card={card} repo={actions.repo} onOpenUrl={actions.onOpenUrl} onRevealIssue={focus.reveal} />
            {card.parentIssueNumber !== null ? (
              <span className="text-xs text-muted-foreground">Parent #{card.parentIssueNumber}</span>
            ) : null}
            {card.subIssuesSummary ? (
              <span
                className="rounded border border-border px-1 text-[11px] tabular-nums text-muted-foreground"
                title="Sub-issue progress"
                aria-label={`${card.subIssuesSummary.completed} of ${card.subIssuesSummary.total} sub-issues complete`}
              >
                {card.subIssuesSummary.completed}/{card.subIssuesSummary.total}
              </span>
            ) : null}
            <LinkedPullRequestLinks pullRequests={card.linkedPullRequests} onOpenUrl={actions.onOpenUrl} />
            {threadLink ? (
              <MetaChip
                title={threadLink.title ? `Thread: ${threadLink.title}` : "Open the linked thread"}
                ariaLabel={threadLink.title ? `Open thread: ${threadLink.title}` : "Open the linked thread"}
                onActivate={() => actions.onOpenThread(threadLink.threadId)}
              >
                <Icon name="MessageSquare" className="size-3" />
                Thread
              </MetaChip>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center gap-0.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Issue actions"
                    aria-label="Issue actions"
                    className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    <Icon name="MoreHorizontal" className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-48" onClick={(event) => event.stopPropagation()}>
                  <IssueActionItems card={card} actions={actions} Item={DropdownMenuItem} Separator={DropdownMenuSeparator} />
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                title="Open issue on GitHub"
                aria-label="Open issue on GitHub"
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onOpenUrl(issueUrl(actions.repo, card.issueNumber));
                }}
              >
                <Icon name="ArrowUpRight" className="size-3.5" />
              </button>
              <button
                type="button"
                title="Start a thread on this issue"
                aria-label="Start a thread on this issue"
                disabled={actions.busy}
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
                onClick={(event) => {
                  event.stopPropagation();
                  actions.onStartThread(card);
                }}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <Icon name="Play" fallback="ArrowRight" className="size-3.5" />
                Start
              </button>
            </div>
          </div>
        </div>
        {card.subIssues.length > 0 ? (
          <>
            <SubIssueToggle
              issue={card}
              expanded={expanded}
              withCount
              onToggle={() => onToggleExpand(card.issueNumber)}
            />
            {expanded ? (
              <SubIssueList
                issues={card.subIssues}
                parentNumber={card.issueNumber}
                terms={terms}
                isExpanded={isExpanded}
                onToggleExpand={onToggleExpand}
                onOpen={onOpenChild}
                actions={actions}
              />
            ) : null}
          </>
        ) : null}
      </article>
    </IssueContextMenu>
  );
}
