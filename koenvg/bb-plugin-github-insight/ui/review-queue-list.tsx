import { useEffect, useState, type ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type {
  LinkedQueuePr,
  NewActivity,
  QueueSection,
  ReturnedReason,
  ReviewThreadStatus,
  rpcContract,
} from "../contract";
import { prKey, type PullRequestRef } from "../core/pr-ref";
import { relativeTime } from "../core/relative-time";
import { isReviewed } from "../core/review-queue-view";
import type { CiState, PrState, QueuePr } from "../core/review-queue";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { messageOf } from "./error-message";
import { IconTooltip } from "./icon-tooltip";
import { Notice, RefreshButton, RefreshError } from "./feedback";
import { usePullRequestsNavigation } from "./pull-requests-routes";
import { ACTION_CLASS, COUNT_CLASS, ICON_ACTION_CLASS, LABEL_CLASS } from "./queue-styles";
import type { ReviewQueueState } from "./use-review-queue";
import { SUCCESS_TEXT } from "./text-tones";
import "./thread-status.css";

const CI_MARK: Record<CiState, { text: string; icon: IconName; className: string }> = {
  passed: { text: "CI passed", icon: "CircleCheck", className: "text-success" },
  failed: { text: "CI failed", icon: "CircleX", className: "text-destructive" },
  running: {
    text: "CI running",
    icon: "Spinner",
    className: "animate-spin text-attention [animation-duration:3s] motion-reduce:animate-none",
  },
  none: { text: "No checks", icon: "Circle", className: "text-subtle-foreground" },
};

const REVIEW_DECISION_LABEL: Record<
  NonNullable<QueuePr["reviewDecision"]>,
  { text: string; className: string } | null
> = {
  APPROVED: { text: "Approved", className: cn("font-medium", SUCCESS_TEXT) },
  CHANGES_REQUESTED: { text: "Changes requested", className: "font-medium text-destructive" },
  REVIEW_REQUIRED: null,
};

const STATE_LABEL: Record<PrState, { text: string; icon: IconName; className: string } | null> = {
  open: null,
  merged: {
    text: "Merged",
    icon: "GitMerge",
    className: "border-violet-500/40 text-violet-700 [.dark_&]:text-violet-300",
  },
  closed: { text: "Closed", icon: "GitPullRequestClosed", className: "" },
};

const ATTENTION_LABEL: Record<
  NewActivity | "updated_since_review",
  { text: string; icon: IconName }
> = {
  updated_since_review: { text: "New commits", icon: "ArrowUp" },
  new_comments: { text: "New comments", icon: "MessageSquare" },
  requested_again: { text: "Review requested again", icon: "UserRoundPlus" },
};

function attentionLabels(pr: LinkedQueuePr): { text: string; icon: IconName }[] {
  const reasons = pr.review === "updated_since_review" ? ["updated_since_review" as const] : [];
  return [...reasons, ...pr.newActivity].map((reason) => ATTENTION_LABEL[reason]);
}

const NEUTRAL_PILL_TONE =
  "review-agent-orbit review-agent-idle text-muted-foreground hover:bg-state-hover hover:text-foreground";

const ACTIVE_AGENT_STATES = ["running", "needs_you", "finished", "failed"] as const;

type ActiveAgentState = (typeof ACTIVE_AGENT_STATES)[number];

type AgentState = ActiveAgentState | "idle";

const AGENT: Record<AgentState, { label: string; dotClass: string; toneClass: string }> = {
  running: {
    label: "Running",
    dotClass: "animate-pulse bg-success motion-reduce:animate-none",
    toneClass:
      "review-agent-orbit review-agent-running bg-success/10 text-foreground hover:bg-success/20",
  },
  needs_you: {
    label: "Needs you",
    dotClass: "bg-attention",
    toneClass:
      "review-agent-orbit review-agent-needs-you bg-attention/15 text-foreground hover:bg-attention/25",
  },
  finished: {
    label: "Ready",
    dotClass: "bg-timeline-accent",
    toneClass:
      "review-agent-orbit review-agent-ready bg-timeline-accent/10 text-foreground hover:bg-timeline-accent/20",
  },
  failed: {
    label: "Failed",
    dotClass: "bg-destructive",
    toneClass:
      "review-agent-orbit review-agent-failed bg-destructive/5 text-destructive hover:bg-destructive/10",
  },
  idle: {
    label: "Waiting",
    dotClass: "bg-muted-foreground/60",
    toneClass: NEUTRAL_PILL_TONE,
  },
};

const THREAD_STATUS_STATE: Record<ReviewThreadStatus, AgentState> = {
  running: "running",
  needs_you: "needs_you",
  idle: "idle",
  error: "failed",
};

const RETURNED_STATE: Record<ReturnedReason, AgentState> = {
  finished: "finished",
  needs_you: "needs_you",
  failed: "failed",
};

function agentStateOf(thread: NonNullable<LinkedQueuePr["thread"]>): AgentState {
  return thread.returned !== null
    ? RETURNED_STATE[thread.returned]
    : THREAD_STATUS_STATE[thread.status];
}

const STATUS_PILL_CLASS =
  "group inline-flex h-9 shrink-0 pointer-coarse:h-11 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

function keyOf(pr: LinkedQueuePr): string {
  return `${pr.repo.toLowerCase()}#${pr.number}`;
}

function refOf(pr: LinkedQueuePr): PullRequestRef {
  const [owner = "", repo = ""] = pr.repo.split("/");
  return { owner, repo, number: pr.number };
}

function isSelected(pr: LinkedQueuePr, selected: PullRequestRef | null): boolean {
  return selected !== null && keyOf(pr) === prKey(selected).toLowerCase();
}

function countOf(section: QueueSection): number {
  return section.reduce((sum, group) => sum + group.prs.length, 0);
}

function hasAgentState(pr: LinkedQueuePr, state: AgentState): boolean {
  return pr.thread !== null && agentStateOf(pr.thread) === state;
}

function onlyAgentState(section: QueueSection, state: AgentState): QueueSection {
  return section
    .map((group) => ({ repo: group.repo, prs: group.prs.filter((pr) => hasAgentState(pr, state)) }))
    .filter((group) => group.prs.length > 0);
}

export function ReviewQueueLists({
  queue,
  selected,
}: {
  queue: ReviewQueueState;
  selected: PullRequestRef | null;
}) {
  const { view, error, refreshing, refresh } = queue;
  const rpc = useRpc<typeof rpcContract>();
  const [archived, setArchived] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<ActiveAgentState | null>(null);

  useEffect(() => {
    setArchived(new Set());
  }, [view]);

  useEffect(() => {
    if (!view?.hasUnseen) return;
    const prs = view.needsReview.flatMap((group) =>
      group.prs.map(({ repo, number }) => ({ repo, number })),
    );
    rpc.call("markQueueSeen", { prs }).catch(() => {});
  }, [rpc, view]);

  function setBusyKey(key: string, on: boolean) {
    setBusy((keys) => {
      const next = new Set(keys);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function mark(pr: LinkedQueuePr, reviewed: boolean) {
    const key = keyOf(pr);
    setActionError(null);
    setBusyKey(key, true);
    const { repo, number, headOid } = pr;
    const result = await (
      reviewed
        ? rpc.call("markReviewed", { repo, number, headOid })
        : rpc.call("markNeedsReview", { repo, number })
    ).catch((failure: unknown) => ({ kind: "error" as const, message: messageOf(failure) }));
    if (result.kind === "error") setActionError(result.message);
    setBusyKey(key, false);
  }

  async function archive(pr: LinkedQueuePr, threadId: string) {
    const key = keyOf(pr);
    setActionError(null);
    setBusyKey(key, true);
    try {
      const result = await rpc.call("archiveReview", { threadId });
      if (result.kind === "ok") setArchived((ids) => new Set(ids).add(threadId));
      else setActionError(result.message);
    } catch (failure) {
      setActionError(messageOf(failure));
    } finally {
      setBusyKey(key, false);
    }
  }

  const withoutArchivedThreads = (section: QueueSection): QueueSection =>
    section.map((group) => ({
      repo: group.repo,
      prs: group.prs.map((pr) =>
        pr.thread !== null && archived.has(pr.thread.id) ? { ...pr, thread: null } : pr,
      ),
    }));
  const needsReview = withoutArchivedThreads(view?.needsReview ?? []);
  const reviewed = withoutArchivedThreads(view?.reviewed ?? []);
  const needsReviewCount = countOf(needsReview);
  if (needsReviewCount === 0 && agentFilter !== null) setAgentFilter(null);
  const actions: CardHandlers = {
    busy: (pr) => busy.has(keyOf(pr)),
    selected: (pr) => isSelected(pr, selected),
    mark: (pr, value) => void mark(pr, value),
    archive: (pr, threadId) => void archive(pr, threadId),
  };

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      {error !== null && (
        <RefreshError
          message={error}
          refreshedAt={view?.loadedAt ?? null}
          retry={refresh}
          busy={refreshing}
        />
      )}
      {actionError !== null && <ActionError message={actionError} />}
      {view === null ? (
        error === null && <Notice>Loading pull requests…</Notice>
      ) : (
        <>
          <QueueSectionView
            label="Needs review"
            section={agentFilter === null ? needsReview : onlyAgentState(needsReview, agentFilter)}
            count={needsReviewCount}
            empty={
              needsReviewCount === 0 ? (
                <CaughtUp />
              ) : (
                <FilteredEmpty showAll={() => setAgentFilter(null)} />
              )
            }
            actions={actions}
            headerStart={
              <AgentFilter section={needsReview} active={agentFilter} onChange={setAgentFilter} />
            }
            headerEnd={
              <>
                <span className="text-xs tabular-nums text-subtle-foreground">
                  Updated{" "}
                  <time
                    dateTime={new Date(view.loadedAt).toISOString()}
                    title={new Date(view.loadedAt).toLocaleString()}
                  >
                    {relativeTime(new Date(view.loadedAt), new Date())}
                  </time>
                </span>
                <RefreshButton refreshing={refreshing} refresh={refresh} />
              </>
            }
            footer={
              view.truncated && (
                <p className="px-1 text-xs text-muted-foreground">Showing first 50</p>
              )
            }
          />
          <QueueSectionView
            label="Reviewed"
            section={reviewed}
            count={countOf(reviewed)}
            empty={<Notice>No reviewed pull requests</Notice>}
            actions={actions}
            collapsible
          />
        </>
      )}
    </div>
  );
}

function CaughtUp() {
  return (
    <div
      role="status"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-8 text-center"
    >
      <span className="grid size-10 place-items-center rounded-full bg-success/10 duration-500 ease-out animate-in fade-in zoom-in-50 motion-reduce:animate-none">
        <Icon name="CircleCheck" className="size-5 text-success" />
      </span>
      <p className="text-sm font-medium">Nothing to review</p>
      <p className="text-xs text-muted-foreground">
        New review requests and new pushes show up here.
      </p>
    </div>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <Icon name="AlertCircle" className="size-4 shrink-0 text-destructive" />
      <span className="break-words text-destructive">{message}</span>
    </div>
  );
}

function FilteredEmpty({ showAll }: { showAll(): void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
      No pull requests match this filter
      <button
        type="button"
        className={cn(ACTION_CLASS, "-my-1.5 ml-auto h-8 text-foreground")}
        onClick={showAll}
      >
        Show all
      </button>
    </div>
  );
}

function AgentFilter({
  section,
  active,
  onChange,
}: {
  section: QueueSection;
  active: ActiveAgentState | null;
  onChange(state: ActiveAgentState | null): void;
}) {
  const shown = ACTIVE_AGENT_STATES.map((state) => ({
    state,
    count: countOf(onlyAgentState(section, state)),
  })).filter(({ state, count }) => count > 0 || state === active);
  if (shown.length === 0) return null;
  return (
    <div role="group" aria-label="Filter by agent status" className="flex flex-wrap gap-1.5">
      {shown.map(({ state, count }) => {
        const pressed = state === active;
        return (
          <button
            key={state}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(pressed ? null : state)}
            className={cn(
              "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 pointer-coarse:h-11 text-xs font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              pressed
                ? AGENT[state].toneClass
                : "border-border text-muted-foreground hover:bg-state-hover hover:text-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn("size-1.5 rounded-full", AGENT[state].dotClass)}
            />
            {AGENT[state].label} <span className="tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

interface CardHandlers {
  busy(pr: LinkedQueuePr): boolean;
  selected(pr: LinkedQueuePr): boolean;
  mark(pr: LinkedQueuePr, reviewed: boolean): void;
  archive(pr: LinkedQueuePr, threadId: string): void;
}

interface QueueSectionViewProps {
  label: string;
  section: QueueSection;
  count: number;
  empty: ReactNode;
  actions: CardHandlers;
  headerStart?: ReactNode;
  headerEnd?: ReactNode;
  footer?: ReactNode;
  collapsible?: boolean;
}

function QueueSectionView({
  label,
  section,
  count,
  empty,
  actions,
  headerStart,
  headerEnd,
  footer,
  collapsible = false,
}: QueueSectionViewProps) {
  const [expanded, setExpanded] = useState(!collapsible);
  const title = (
    <>
      {label}
      <span data-testid="queue-count" className={COUNT_CLASS}>
        {count}
      </span>
    </>
  );
  return (
    <section aria-label={label} className="@container flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              className="-mx-2 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => setExpanded((open) => !open)}
            >
              <Icon
                name="ChevronRight"
                className={cn(
                  "size-4 text-muted-foreground transition-transform duration-200",
                  expanded && "rotate-90",
                )}
              />
              {title}
            </button>
          ) : (
            title
          )}
        </h2>
        {headerStart}
        {headerEnd !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{headerEnd}</div>
        )}
      </div>
      {expanded &&
        (section.length === 0
          ? empty
          : section.map((group) => (
              <div key={group.repo} className="flex min-w-0 flex-col gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5 px-1 text-xs">
                  <Icon name="FolderGit" className="size-3.5 shrink-0 text-subtle-foreground" />
                  <h3
                    data-testid="queue-group"
                    className="min-w-0 truncate font-medium text-muted-foreground"
                  >
                    {group.repo}
                  </h3>
                  <span className="shrink-0 tabular-nums text-subtle-foreground">
                    {group.prs.length}
                  </span>
                  {!group.prs.some((pr) => pr.projectIds.length > 0) && (
                    <span className="min-w-0 truncate text-subtle-foreground">
                      <span aria-hidden="true">· </span>
                      No bb project for this repository
                    </span>
                  )}
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {group.prs.map((pr) => (
                    <QueueRow
                      key={pr.number}
                      pr={pr}
                      actions={actions}
                      quiet={label === "Reviewed"}
                    />
                  ))}
                </ul>
              </div>
            )))}
      {footer}
    </section>
  );
}

function Separator() {
  return (
    <span aria-hidden="true" className="text-subtle-foreground">
      ·
    </span>
  );
}

function QueueRow({
  pr,
  actions,
  quiet,
}: {
  pr: LinkedQueuePr;
  actions: CardHandlers;
  quiet: boolean;
}) {
  const ci = CI_MARK[pr.ci];
  const decision = pr.reviewDecision === null ? null : REVIEW_DECISION_LABEL[pr.reviewDecision];
  const attention = attentionLabels(pr);
  const state = STATE_LABEL[pr.state];
  const draft = pr.draft && state === null;
  const selected = actions.selected(pr);
  return (
    <li
      aria-label={`${pr.repo}#${pr.number}`}
      aria-current={selected || undefined}
      className={cn(
        "grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-3 py-3 @lg:grid-cols-[1rem_minmax(0,1fr)_auto]",
        selected && "bg-state-hover",
      )}
    >
      <IconTooltip label={ci.text}>
        <span
          data-testid="queue-ci"
          role="img"
          aria-label={ci.text}
          tabIndex={0}
          className="mt-0.5 flex size-4 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icon name={ci.icon} className={cn("size-4", ci.className)} />
        </span>
      </IconTooltip>
      <div className="flex min-w-0 flex-col gap-1">
        <h4
          className={cn(
            "min-w-0 break-words text-sm font-semibold",
            quiet && "font-medium text-muted-foreground",
          )}
        >
          <span className="font-mono text-xs font-normal tabular-nums text-subtle-foreground">
            #{pr.number}
          </span>{" "}
          {pr.title}
        </h4>
        <div
          data-testid="queue-meta"
          className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground"
        >
          {pr.author !== null && (
            <>
              <span className="min-w-0 truncate">{pr.author}</span>
              <Separator />
            </>
          )}
          <time
            dateTime={pr.updatedAt}
            title={new Date(pr.updatedAt).toLocaleString()}
            className="shrink-0 tabular-nums"
          >
            {relativeTime(new Date(pr.updatedAt), new Date())}
          </time>
          {decision !== null && (
            <>
              <Separator />
              <span
                data-testid="queue-review-decision"
                className={cn("shrink-0", decision.className)}
              >
                {decision.text}
              </span>
            </>
          )}
          {(draft || state !== null || attention.length > 0) && <span className="w-1" />}
          {state !== null && (
            <span className={cn(LABEL_CLASS, "flex items-center gap-1", state.className)}>
              <Icon name={state.icon} className="size-3" />
              {state.text}
            </span>
          )}
          {draft && <span className={LABEL_CLASS}>Draft</span>}
          {attention.map(({ icon, text }) => (
            <span
              key={text}
              className={cn(
                LABEL_CLASS,
                "flex items-center gap-1 border-attention/50 bg-attention/10 text-foreground",
              )}
            >
              <Icon name={icon} className="size-3 text-attention" />
              {text}
            </span>
          ))}
        </div>
      </div>
      <RowActions pr={pr} actions={actions} />
    </li>
  );
}

function RowActions({ pr, actions }: { pr: LinkedQueuePr; actions: CardHandlers }) {
  const navigation = usePullRequestsNavigation();
  const thread = pr.thread;
  const busy = actions.busy(pr);
  const reviewed = isReviewed(pr);
  const markLabel = reviewed ? "Mark as needs review" : "Mark reviewed";
  const overviewShown = actions.selected(pr);
  const overviewLabel = overviewShown ? "Hide overview" : "Show overview";
  const archiveThreadId = thread?.isReviewThread ? thread.id : null;
  return (
    <div className="col-start-2 -ml-2 flex flex-wrap items-center gap-0.5 @lg:col-start-3 @lg:row-start-1 @lg:-mr-1.5 @lg:ml-0 @lg:self-center">
      <div className="ml-2 mr-1 flex shrink-0 empty:hidden @lg:ml-0 @lg:min-w-36 @lg:justify-end @lg:empty:block">
        {thread !== null ? (
          <ThreadStatusButton
            state={agentStateOf(thread)}
            onClick={() => navigation.toThread(thread.id)}
          />
        ) : (
          pr.projectIds.length > 0 && (
            <PillButton
              toneClass={NEUTRAL_PILL_TONE}
              leading={<Icon name="MessageSquarePlus" className="size-3.5 shrink-0" />}
              onClick={() => navigation.go({ kind: "review", repo: pr.repo, number: pr.number })}
            >
              Start review
            </PillButton>
          )
        )}
      </div>
      <IconTooltip
        label={archiveThreadId !== null ? "Archive thread" : "Only review threads can be archived"}
      >
        <button
          type="button"
          aria-label="Archive thread"
          aria-disabled={archiveThreadId !== null ? undefined : true}
          className={ICON_ACTION_CLASS}
          onClick={() => {
            if (archiveThreadId !== null) actions.archive(pr, archiveThreadId);
          }}
          disabled={archiveThreadId !== null && busy}
        >
          <Icon name="Archive" className="size-4" />
        </button>
      </IconTooltip>
      <IconTooltip label={markLabel}>
        <button
          type="button"
          aria-label={markLabel}
          className={cn(ICON_ACTION_CLASS, !reviewed && "hover:text-success")}
          onClick={() => actions.mark(pr, !reviewed)}
          disabled={busy}
        >
          <Icon
            name={busy ? "Loading" : reviewed ? "RotateCcw" : "Check"}
            className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")}
          />
        </button>
      </IconTooltip>
      <IconTooltip label={overviewLabel}>
        <button
          type="button"
          aria-label={overviewLabel}
          className={cn(ICON_ACTION_CLASS, overviewShown && "bg-state-active text-foreground")}
          onClick={() =>
            navigation.go({ kind: "list", selected: overviewShown ? null : refOf(pr) })
          }
        >
          <Icon name="Github" className="size-4" />
        </button>
      </IconTooltip>
    </div>
  );
}

function ThreadStatusButton({ state, onClick }: { state: AgentState; onClick(): void }) {
  const agent = AGENT[state];
  return (
    <PillButton
      toneClass={agent.toneClass}
      leading={
        <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", agent.dotClass)} />
      }
      onClick={onClick}
    >
      <span className="sr-only">Open thread:</span>{" "}
      <span data-testid="review-status">{agent.label}</span>
    </PillButton>
  );
}

function PillButton({
  toneClass,
  leading,
  onClick,
  children,
}: {
  toneClass: string;
  leading: ReactNode;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={cn(STATUS_PILL_CLASS, toneClass)} onClick={onClick}>
      {leading}
      {children}
      <Icon
        name="ChevronRight"
        className="-mr-1.5 size-3.5 shrink-0 opacity-50 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}
