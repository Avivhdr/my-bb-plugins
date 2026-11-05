import { useEffect, useState, type ReactNode } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type {
  LinkedQueuePr,
  NewActivity,
  QueueLayer,
  QueueSection,
  ReturnedReason,
  ReviewThreadStatus,
  rpcContract,
} from "../contract";
import { prKey, type PullRequestRef } from "../core/pr-ref";
import { relativeTime } from "../core/relative-time";
import { countedPrs, isReviewed } from "../core/review-queue-view";
import type { CiState, PrState, QueuePr } from "../core/review-queue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { messageOf } from "./error-message";
import { Avatar } from "./avatar";
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

const AGENT_STATES = ["running", "needs_you", "finished", "failed"] as const;

/** An idle agent shows as finished ("Ready"), whether or not you opened its thread. */
type AgentState = (typeof AGENT_STATES)[number];

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
};

const THREAD_STATUS_STATE: Record<ReviewThreadStatus, AgentState> = {
  running: "running",
  needs_you: "needs_you",
  idle: "finished",
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
  "group inline-flex h-7 shrink-0 pointer-coarse:h-10 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium transition-colors duration-150 hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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

type ActionResultPromise = Promise<{ kind: "ok" } | { kind: "error"; message: string }>;

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
  const [agentFilter, setAgentFilter] = useState<AgentState | null>(null);

  useEffect(() => {
    setArchived(new Set());
  }, [view]);

  useEffect(() => {
    if (!view?.hasUnseen) return;
    const prs = view.layers.flatMap(countedPrs).map(({ repo, number }) => ({ repo, number }));
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

  async function runAction(key: string, call: () => ActionResultPromise) {
    setActionError(null);
    setBusyKey(key, true);
    const result = await call().catch((failure: unknown) => ({
      kind: "error" as const,
      message: messageOf(failure),
    }));
    if (result.kind === "error") setActionError(result.message);
    setBusyKey(key, false);
  }

  function mark(pr: LinkedQueuePr, reviewed: boolean) {
    const { repo, number, headOid } = pr;
    return runAction(keyOf(pr), () =>
      reviewed
        ? rpc.call("markReviewed", { repo, number, headOid })
        : rpc.call("markNeedsReview", { repo, number }),
    );
  }

  function ignore(pr: LinkedQueuePr, ignored: boolean) {
    const { repo, number } = pr;
    return runAction(keyOf(pr), () =>
      rpc.call(ignored ? "ignorePr" : "unignorePr", { repo, number }),
    );
  }

  function reReview(pr: LinkedQueuePr, threadId: string) {
    const { repo, number, headOid } = pr;
    return runAction(keyOf(pr), () => rpc.call("reReview", { threadId, repo, number, headOid }));
  }

  function setTeammatesTeam(team: string | null) {
    return runAction("teammates-team", () => rpc.call("setTeammatesTeam", { team }));
  }

  function setRepoHidden(repo: string, layer: string | null, hidden: boolean) {
    return runAction(`repo:${repo}`, () =>
      rpc.call(hidden ? "hideRepo" : "showRepo", { repo, layer }),
    );
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
  const layers = (view?.layers ?? []).map((layer) => ({
    ...layer,
    prs: withoutArchivedThreads(layer.prs),
  }));
  const waiting = layers.flatMap((layer) => layer.prs);
  if (countOf(waiting) === 0 && agentFilter !== null) setAgentFilter(null);
  const actions: CardHandlers = {
    busy: (pr) => busy.has(keyOf(pr)),
    selected: (pr) => isSelected(pr, selected),
    mark: (pr, value) => void mark(pr, value),
    ignore: (pr, value) => void ignore(pr, value),
    archive: (pr, threadId) => void archive(pr, threadId),
    reReview: (pr, threadId) => void reReview(pr, threadId),
  };
  const shown = (section: QueueSection) =>
    agentFilter === null ? section : onlyAgentState(section, agentFilter);
  // An empty layer is left out, except Teammates while it needs a team or could not read it.
  const needsTeamNotice = (layer: QueueLayer) =>
    layer.teammates === "only" && (view?.teammatesTeam === null || view?.teammatesError != null);
  const shownLayers = layers.filter((layer) => layer.prs.length > 0 || needsTeamNotice(layer));
  const teammatesLayer = layers.find((layer) => layer.teammates === "only");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
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
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <AgentFilter section={waiting} active={agentFilter} onChange={setAgentFilter} />
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {teammatesLayer !== undefined && (
                <TeamPicker
                  team={view.teammatesTeam}
                  pick={(team) => void setTeammatesTeam(team)}
                />
              )}
              <HiddenReposMenu
                layers={layers}
                everywhere={view.hiddenEverywhere}
                show={(repo, scope) => void setRepoHidden(repo, scope, false)}
              />
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
            </div>
          </div>
          {shownLayers.length === 0 && <Notice>Nothing to review</Notice>}
          {shownLayers.map((layer) => (
            <QueueSectionView
              key={layer.name}
              label={layer.name}
              section={shown(layer.prs)}
              count={layer.count}
              empty={
                agentFilter !== null && layer.prs.length > 0 ? (
                  <FilteredEmpty showAll={() => setAgentFilter(null)} />
                ) : view.teammatesTeam === null ? (
                  <Notice>Pick your team to list your teammates' pull requests here.</Notice>
                ) : (
                  <Notice>
                    Could not read the members of {view.teammatesTeam}: {view.teammatesError}
                  </Notice>
                )
              }
              actions={actions}
              repoMenu={(repo) => (
                <HideRepoMenu
                  repo={repo}
                  layer={layer.name}
                  hide={(scope) => void setRepoHidden(repo, scope, true)}
                />
              )}
              footer={
                layer.truncated && (
                  <p className="px-1 text-xs text-muted-foreground">Showing first 50</p>
                )
              }
            />
          ))}
          {countOf(view.reviewed) > 0 && (
            <QueueSectionView
              label="Reviewed"
              section={withoutArchivedThreads(view.reviewed)}
              count={countOf(view.reviewed)}
              empty={null}
              actions={actions}
              collapsible
              quiet
            />
          )}
          {countOf(view.merged) > 0 && (
            <QueueSectionView
              label="Merged"
              section={withoutArchivedThreads(view.merged)}
              count={countOf(view.merged)}
              empty={null}
              actions={actions}
              collapsible
              quiet
            />
          )}
          {countOf(view.ignored) > 0 && (
            <QueueSectionView
              label="Ignored"
              section={withoutArchivedThreads(view.ignored)}
              count={countOf(view.ignored)}
              empty={null}
              actions={actions}
              collapsible
              quiet
            />
          )}
        </>
      )}
    </div>
  );
}

type TeamsState =
  | { kind: "loading" }
  | { kind: "ok"; teams: { team: string; name: string }[] }
  | { kind: "error"; message: string };

/** Picks the GitHub team whose members are your teammates. Reads your teams when it opens. */
function TeamPicker({ team, pick }: { team: string | null; pick(team: string | null): void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [teams, setTeams] = useState<TeamsState>({ kind: "loading" });

  function load(open: boolean) {
    if (!open) return;
    setTeams({ kind: "loading" });
    rpc
      .call("getViewerTeams", {})
      .then(setTeams, (failure: unknown) =>
        setTeams({ kind: "error", message: messageOf(failure) }),
      );
  }

  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(ACTION_CLASS, team === null ? "text-foreground" : "text-muted-foreground")}
        >
          <Icon name="UserRound" className="size-3.5" />
          {team ?? "Pick your team"}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Your teammates are the members of</DropdownMenuLabel>
        {teams.kind === "loading" && <DropdownMenuItem disabled>Loading teams…</DropdownMenuItem>}
        {teams.kind === "error" && (
          <DropdownMenuItem disabled>Could not read your teams: {teams.message}</DropdownMenuItem>
        )}
        {teams.kind === "ok" &&
          teams.teams.map((entry) => (
            <DropdownMenuItem key={entry.team} onSelect={() => pick(entry.team)}>
              <Icon
                name="Check"
                className={cn("size-3.5 shrink-0", entry.team !== team && "invisible")}
              />
              {entry.name}
              <span className="truncate text-subtle-foreground">{entry.team}</span>
            </DropdownMenuItem>
          ))}
        {team !== null && (
          <DropdownMenuItem onSelect={() => pick(null)}>
            <Icon name="X" className="size-3.5 shrink-0" />
            No team
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HideRepoMenu({
  repo,
  layer,
  hide,
}: {
  repo: string;
  layer: string;
  hide(scope: string | null): void;
}) {
  return (
    <DropdownMenu>
      <IconTooltip label="Hide repository">
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Hide ${repo}`}
            className={cn(ICON_ACTION_CLASS, "-my-2 size-7 pointer-coarse:size-9")}
          >
            <Icon name="MoreHorizontal" className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
      </IconTooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => hide(layer)}>
          <Icon name="EyeOff" className="size-3.5 shrink-0" />
          Hide from {layer}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => hide(null)}>
          <Icon name="EyeOff" className="size-3.5 shrink-0" />
          Hide everywhere
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HiddenReposMenu({
  layers,
  everywhere,
  show,
}: {
  layers: readonly QueueLayer[];
  everywhere: readonly string[];
  show(repo: string, scope: string | null): void;
}) {
  const groups = [
    ...layers
      .filter((layer) => layer.hiddenRepos.length > 0)
      .map((layer) => ({
        label: `Hidden from ${layer.name}`,
        scope: layer.name,
        repos: layer.hiddenRepos,
      })),
    ...(everywhere.length > 0
      ? [{ label: "Hidden everywhere", scope: null, repos: everywhere }]
      : []),
  ];
  const count = groups.reduce((sum, group) => sum + group.repos.length, 0);
  if (count === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(ACTION_CLASS, "h-8 text-muted-foreground")}>
          <Icon name="EyeOff" className="size-3.5" />
          {count} hidden
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {groups.map((group) => (
          <DropdownMenuGroup key={group.label}>
            <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
            {group.repos.map((repo) => (
              <DropdownMenuItem key={repo} onSelect={() => show(repo, group.scope)}>
                <Icon name="Eye" className="size-3.5 shrink-0" />
                Show {repo} again
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  active: AgentState | null;
  onChange(state: AgentState | null): void;
}) {
  const shown = AGENT_STATES.map((state) => ({
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
  ignore(pr: LinkedQueuePr, ignored: boolean): void;
  archive(pr: LinkedQueuePr, threadId: string): void;
  reReview(pr: LinkedQueuePr, threadId: string): void;
}

interface QueueSectionViewProps {
  label: string;
  section: QueueSection;
  count: number;
  empty: ReactNode;
  actions: CardHandlers;
  headerEnd?: ReactNode;
  footer?: ReactNode;
  collapsible?: boolean;
  quiet?: boolean;
  repoMenu?(repo: string): ReactNode;
}

function QueueSectionView({
  label,
  section,
  count,
  empty,
  actions,
  headerEnd,
  footer,
  collapsible = false,
  quiet = false,
  repoMenu,
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
    <section aria-label={label} className="@container flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          {collapsible ? (
            <button
              type="button"
              aria-expanded={expanded}
              className="-mx-2 inline-flex h-7 cursor-pointer items-center gap-2 rounded-md px-2 transition-colors duration-150 hover:bg-state-hover hover:duration-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
        {headerEnd !== undefined && (
          <div className="ml-auto flex shrink-0 items-center gap-2">{headerEnd}</div>
        )}
      </div>
      {expanded &&
        (section.length === 0
          ? empty
          : section.map((group) => (
              <div key={group.repo} className="flex min-w-0 flex-col gap-1">
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
                  {repoMenu?.(group.repo)}
                </div>
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
                  {group.prs.map((pr) => (
                    <QueueRow key={pr.number} pr={pr} actions={actions} quiet={quiet} />
                  ))}
                </ul>
              </div>
            )))}
      {footer}
    </section>
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
  const navigation = usePullRequestsNavigation();
  const ci = CI_MARK[pr.ci];
  const decision = pr.reviewDecision === null ? null : REVIEW_DECISION_LABEL[pr.reviewDecision];
  const attention = attentionLabels(pr);
  const state = STATE_LABEL[pr.state];
  const draft = pr.draft && state === null;
  const selected = actions.selected(pr);
  const skipped = pr.skipLabel !== null;
  return (
    <li
      aria-label={`${pr.repo}#${pr.number}`}
      aria-current={selected || undefined}
      className={cn(
        "flex min-w-0 items-center gap-1 pr-1.5 transition-colors duration-150 hover:bg-state-hover hover:duration-0",
        selected && "bg-state-hover",
        skipped && "opacity-60",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`${selected ? "Hide" : "Show"} overview of #${pr.number} ${pr.title}`}
        title={selected ? "Hide overview" : "Show overview"}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch py-2 pl-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => navigation.go({ kind: "list", selected: selected ? null : refOf(pr) })}
      >
        <span
          data-testid="queue-ci"
          role="img"
          aria-label={ci.text}
          title={ci.text}
          className="flex size-4 shrink-0 items-center justify-center"
        >
          <Icon name={ci.icon} className={cn("size-4", ci.className)} />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-sm font-medium",
            (quiet || skipped) && "text-muted-foreground",
          )}
          title={pr.title}
        >
          <span className="font-mono text-xs font-normal tabular-nums text-subtle-foreground">
            #{pr.number}
          </span>{" "}
          {pr.title}
        </span>
        <span
          data-testid="queue-meta"
          className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          {pr.skipLabel !== null && (
            <span
              data-testid="queue-skip-label"
              className={cn(LABEL_CLASS, "border-attention/50 py-0 uppercase tracking-wide")}
            >
              {pr.skipLabel}
            </span>
          )}
          {state !== null && (
            <span className={cn(LABEL_CLASS, "flex items-center gap-1 py-0", state.className)}>
              <Icon name={state.icon} className="size-3" />
              {state.text}
            </span>
          )}
          {draft && <span className={cn(LABEL_CLASS, "py-0")}>Draft</span>}
          {attention.map(({ icon, text }) => (
            <span
              key={text}
              className={cn(
                LABEL_CLASS,
                "flex items-center gap-1 border-attention/50 bg-attention/10 py-0 text-foreground",
              )}
            >
              <Icon name={icon} className="size-3 text-attention" />
              {text}
            </span>
          ))}
          {decision !== null && (
            <span
              data-testid="queue-review-decision"
              className={cn("hidden @md:inline", decision.className)}
            >
              {decision.text}
            </span>
          )}
          {pr.additions !== null && pr.deletions !== null && (
            <span
              data-testid="queue-line-counts"
              title={`${pr.additions} lines added, ${pr.deletions} removed`}
              className="inline-flex shrink-0 gap-1 font-mono tabular-nums"
            >
              <span className={SUCCESS_TEXT}>+{pr.additions}</span>
              <span className="text-destructive">-{pr.deletions}</span>
            </span>
          )}
          {pr.author !== null && <Avatar login={pr.author} url={pr.authorAvatarUrl} labelled />}
          <time
            dateTime={pr.createdAt}
            title={`Opened ${new Date(pr.createdAt).toLocaleString()}, updated ${new Date(pr.updatedAt).toLocaleString()}`}
            className="w-20 shrink-0 text-right tabular-nums"
          >
            {relativeTime(new Date(pr.createdAt), new Date())}
          </time>
        </span>
      </button>
      <RowActions pr={pr} actions={actions} />
    </li>
  );
}

function RowActions({ pr, actions }: { pr: LinkedQueuePr; actions: CardHandlers }) {
  const navigation = usePullRequestsNavigation();
  const bbNavigate = useBbNavigate();
  const thread = pr.thread;
  const busy = actions.busy(pr);
  const reviewed = isReviewed(pr);
  const archiveThreadId = thread?.isReviewThread ? thread.id : null;
  // Re-review takes the place of an idle agent's status; "Open thread" moves to the menu.
  const reReviewThread =
    thread?.isReviewThread === true && pr.reReview && agentStateOf(thread) === "finished"
      ? thread
      : null;
  return (
    <>
      {reReviewThread !== null ? (
        <PillButton
          toneClass={NEUTRAL_PILL_TONE}
          leading={<Icon name="ArrowReloadHorizontal" className="size-3.5 shrink-0" />}
          title="Send the new commits and replies to the review agent"
          disabled={busy}
          onClick={() => actions.reReview(pr, reReviewThread.id)}
        >
          Re-review
        </PillButton>
      ) : thread !== null ? (
        <ThreadStatusButton
          state={agentStateOf(thread)}
          onClick={() => navigation.toThread(thread.id)}
        />
      ) : (
        pr.projectIds.length > 0 &&
        (pr.autoQueued ? (
          <PillButton
            toneClass={NEUTRAL_PILL_TONE}
            leading={<Icon name="Clock" className="size-3.5 shrink-0" />}
            title="Auto-review starts this one when a review slot frees up. Click to start it yourself now."
            onClick={() => navigation.go({ kind: "review", repo: pr.repo, number: pr.number })}
          >
            Queued
          </PillButton>
        ) : (
          <PillButton
            toneClass={NEUTRAL_PILL_TONE}
            leading={<Icon name="MessageSquarePlus" className="size-3.5 shrink-0" />}
            onClick={() => navigation.go({ kind: "review", repo: pr.repo, number: pr.number })}
          >
            Start review
          </PillButton>
        ))
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className={cn(ICON_ACTION_CLASS, "size-8 pointer-coarse:size-10")}
            disabled={busy}
          >
            <Icon
              name={busy ? "Loading" : "MoreHorizontal"}
              className={cn("size-4", busy && "animate-spin motion-reduce:animate-none")}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => bbNavigate.openUrl(pr.url)}>
            <Icon name="ExternalLink" className="size-3.5 shrink-0" />
            Open in GitHub
          </DropdownMenuItem>
          {reReviewThread !== null && (
            <DropdownMenuItem onSelect={() => navigation.toThread(reReviewThread.id)}>
              <Icon name="MessageSquare" className="size-3.5 shrink-0" />
              Open thread
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => actions.mark(pr, !reviewed)}>
            <Icon name={reviewed ? "RotateCcw" : "Check"} className="size-3.5 shrink-0" />
            {reviewed ? "Mark as needs review" : "Mark reviewed"}
          </DropdownMenuItem>
          {pr.state === "open" && (
            <DropdownMenuItem onSelect={() => actions.ignore(pr, !pr.ignored)}>
              <Icon name={pr.ignored ? "Eye" : "EyeOff"} className="size-3.5 shrink-0" />
              {pr.ignored ? "Stop ignoring" : "Ignore"}
            </DropdownMenuItem>
          )}
          {archiveThreadId !== null && (
            <DropdownMenuItem onSelect={() => actions.archive(pr, archiveThreadId)}>
              <Icon name="Archive" className="size-3.5 shrink-0" />
              Archive thread
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
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
  title,
  disabled,
  onClick,
  children,
}: {
  toneClass: string;
  leading: ReactNode;
  title?: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(STATUS_PILL_CLASS, toneClass, "disabled:cursor-default disabled:opacity-60")}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      {leading}
      {children}
      <Icon
        name="ChevronRight"
        className="-mr-1.5 size-3.5 shrink-0 opacity-50 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
      />
    </button>
  );
}
