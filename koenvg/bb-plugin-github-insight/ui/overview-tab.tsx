import { useEffect, useId, useState, type ReactNode, type RefObject } from "react";
import { UrlLink, useBbNavigate } from "@get-bb/plugin-sdk/app";
import { countOf, type Blocker } from "../core/blockers";
import type { Check, CheckStatus } from "../core/checks";
import type { CheckFailure } from "../core/failure";
import type { InsightResult } from "../contract";
import type { PrInsight } from "../core/overview";
import { relativeTime } from "../core/relative-time";
import { reviewerKey, type Reviewer } from "../core/reviewers";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { blockerTone } from "./blocker-tone";
import { useCommandIntent, type IntentOf } from "./command-intents";
import { AutoMergeButton } from "./auto-merge-button";
import { BranchUpdateButton, PullReminder } from "./branch-update-button";
import { MergeActionButton } from "./merge-action-button";
import { useShowFiles } from "./files-jump";
import { OverviewSection } from "./overview-section";
import { useReportSummary } from "./pr-tab-summary";
import { SUCCESS_TEXT } from "./text-tones";
import { TimelineSections } from "./timeline";
import { useInsight } from "./use-insight";
import { BUTTON_CLASS, Notice, RefreshButton, RefreshError } from "./feedback";
import {
  listedBlockers,
  prStatusView,
  prSummaryLine,
  type PrStatusView,
  type StatusRow,
  type SummaryLine,
} from "./pr-status-view";

const OPEN_STATUSES: readonly CheckStatus[] = ["failed", "cancelled", "waiting", "running"];

const COLLAPSED_STATUSES: readonly CheckStatus[] = ["passed", "skipped"];

const STATUS_ICON: Record<CheckStatus, { name: IconName; className: string }> = {
  failed: { name: "CircleX", className: "text-destructive" },
  cancelled: { name: "Unavailable", className: "text-muted-foreground" },
  waiting: { name: "UserRound", className: "text-attention" },
  running: { name: "Spinner", className: "text-attention" },
  passed: { name: "CircleCheck", className: "text-success" },
  skipped: { name: "Circle", className: "text-muted-foreground" },
};

const REVIEWER_STATE_LABEL: Record<Reviewer["state"], string> = {
  pending: "Pending",
  approved: "Approved",
  changes_requested: "Changes requested",
  commented: "Commented",
  dismissed: "Dismissed",
};

function usePrCommands(
  threadId: string,
  { result, refreshing, refresh }: ReturnType<typeof useInsight>,
) {
  const navigate = useBbNavigate();
  const [intent, setIntent] = useState<IntentOf<"overview"> | null>(null);
  useCommandIntent(threadId, "overview", setIntent);

  useEffect(() => {
    if (intent === null || result === null || refreshing) return;
    setIntent(null);
    if (intent === "refresh") {
      refresh();
      return;
    }
    if (result.kind !== "ok") return;
    if (intent === "open-on-github") navigate.openUrl(result.insight.pr.url);
  }, [intent, result, refreshing, refresh, navigate]);
}

interface OverviewTabProps {
  threadId: string;
  scrollRoot: RefObject<HTMLElement | null>;
}

export function OverviewTab({ threadId, scrollRoot }: OverviewTabProps) {
  return <OverviewTabContent key={threadId} threadId={threadId} scrollRoot={scrollRoot} />;
}

function OverviewTabContent({ threadId, scrollRoot }: OverviewTabProps) {
  const insight = useInsight(threadId);
  const [branchUpdated, setBranchUpdated] = useState(false);
  usePrCommands(threadId, insight);
  useReportedSummary(insight.result);
  return (
    <PrOverview
      insight={insight}
      noPrText="No pull request for this thread"
      controls={{ threadId, onBranchUpdated: () => setBranchUpdated(true) }}
      notice={branchUpdated && <PullReminder dismiss={() => setBranchUpdated(false)} />}
      renderDetails={(details, refreshedAt) => (
        <TimelineSections
          threadId={threadId}
          refreshedAt={refreshedAt}
          scrollRoot={scrollRoot}
          between={details}
        />
      )}
    />
  );
}

export interface InsightView {
  result: InsightResult | null;
  refreshing: boolean;
  revalidating: boolean;
  refresh: () => void;
}

export interface ThreadControls {
  threadId: string;
  onBranchUpdated: () => void;
}

interface PrOverviewProps {
  insight: InsightView;
  noPrText: string;
  controls: ThreadControls | null;
  notice?: ReactNode;
  renderDetails?: (details: ReactNode, refreshedAt: number) => ReactNode;
}

export function PrOverview({
  insight: { result, refreshing, revalidating, refresh },
  noPrText,
  controls,
  notice,
  renderDetails = (details) => details,
}: PrOverviewProps) {
  if (result === null) return <Notice>Loading pull request…</Notice>;
  if (result.kind === "no_pr") return <Notice>{noPrText}</Notice>;
  if (result.kind === "error") {
    return (
      <RefreshError message={result.message} refreshedAt={null} retry={refresh} busy={refreshing} />
    );
  }
  const status = prStatusView(result.insight);
  return (
    <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-4">
        <PrHeader
          pr={result.insight.pr}
          lifecycle={status.lifecycle}
          age={<DataAge refreshedAt={result.refreshedAt} updating={revalidating} />}
          action={
            <RefreshButton refreshing={refreshing} refresh={refresh} className={TOOLBAR_SIZE} />
          }
        />
        {result.error !== null && (
          <RefreshError
            message={result.error}
            refreshedAt={result.refreshedAt}
            retry={refresh}
            busy={refreshing}
          />
        )}
        {notice}
        <MergeStatusCard insight={result.insight} status={status} controls={controls} />
      </div>
      {renderDetails(
        <>
          {!reviewersInCard(status.blockers) && (
            <ReviewerList reviewers={result.insight.reviewers} />
          )}
          <CheckList
            checks={result.insight.checks}
            shownInCard={checkStatusesInCard(status.blockers)}
          />
        </>,
        result.refreshedAt,
      )}
    </div>
  );
}

function useReportedSummary(result: ReturnType<typeof useInsight>["result"]) {
  const report = useReportSummary();
  const files = result?.kind === "ok" ? result.insight.pr.changedFiles : null;
  const unresolvedThreads =
    result?.kind === "ok" &&
    result.insight.blockers.some(({ code }) => code === "unresolved_threads");
  useEffect(() => {
    report(files === null ? null : { files, unresolvedThreads });
  }, [report, files, unresolvedThreads]);
}

const REVIEW_BLOCKERS: ReadonlySet<Blocker["code"]> = new Set([
  "review_required",
  "changes_requested",
]);

function reviewersInCard(blockers: readonly Blocker[]): boolean {
  return listedBlockers(blockers).some(({ code }) => REVIEW_BLOCKERS.has(code));
}

function checkStatusesInCard(blockers: readonly Blocker[]): ReadonlySet<CheckStatus> {
  return new Set(
    listedBlockers(blockers).flatMap(({ code }) => {
      const status = CHECK_STATUS_OF_BLOCKER[code];
      return status === undefined ? [] : [status];
    }),
  );
}

function OverviewCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
      {children}
    </div>
  );
}

const TOOLBAR_SIZE = "h-7 px-2.5";

function PrHeader({
  pr,
  lifecycle,
  age,
  action,
}: {
  pr: PrInsight["pr"];
  lifecycle: StatusRow;
  age: ReactNode;
  action: ReactNode;
}) {
  const merged = pr.state === "merged";
  return (
    <div data-testid="pr-header" className="flex min-w-0 flex-col gap-2">
      {merged && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg bg-violet-500/10 px-3 py-3 text-violet-700 [.dark_&]:text-violet-300"
        >
          <Icon name="GitMerge" aria-hidden="true" className="size-5 shrink-0" />
          <h2 className="text-sm font-semibold">{lifecycle.text}</h2>
        </div>
      )}
      <div className="flex min-w-0 items-start gap-3">
        <h2 className="min-w-0 flex-1 text-sm font-semibold leading-snug text-balance break-words">
          {pr.title}
        </h2>
        <div className="flex shrink-0 items-center gap-1.5">
          <UrlLink
            href={pr.url}
            aria-label="Open on GitHub"
            className={cn(BUTTON_CLASS, TOOLBAR_SIZE)}
          >
            GitHub
            <Icon name="ArrowUpRight" aria-hidden="true" className="size-3.5" />
          </UrlLink>
          {action}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono tabular-nums">#{pr.number}</span>
        {!merged && (
          <span className="rounded-full bg-muted px-2 py-px font-medium text-foreground">
            {lifecycle.text}
          </span>
        )}
        {pr.author !== null && (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Icon name="UserRound" aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="truncate">{pr.author}</span>
          </span>
        )}
        {age}
      </div>
      <PrMeta pr={pr} />
    </div>
  );
}

function branchLabel(pr: PrInsight["pr"]): string {
  const head = pr.headOwner === null ? pr.headRefName : `${pr.headOwner}:${pr.headRefName}`;
  return `${head} → ${pr.baseRefName}`;
}

function PrMeta({ pr }: { pr: PrInsight["pr"] }) {
  return (
    <div className="flex min-w-0 items-center gap-x-3 text-xs text-muted-foreground">
      <span className="inline-flex min-w-0 items-center gap-1" title={branchLabel(pr)}>
        <Icon name="GitBranch" aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate font-mono">{branchLabel(pr)}</span>
      </span>
      <span className="inline-flex shrink-0 gap-1 font-mono tabular-nums">
        <span className={SUCCESS_TEXT}>+{pr.additions}</span>
        <span className="text-destructive">-{pr.deletions}</span>
      </span>
      <span className="shrink-0 tabular-nums">{countOf(pr.changedFiles, "file")}</span>
    </div>
  );
}

interface MergeStatusCardProps {
  insight: PrInsight;
  status: PrStatusView;
  controls: ThreadControls | null;
}

function MergeStatusCard({ insight, status, controls }: MergeStatusCardProps) {
  const line = prSummaryLine(insight);
  if (line === null && insight.pr.state !== "draft") return null;
  const blockers = listedBlockers(status.blockers);
  const { autoMergeAction, pr } = insight;
  const ready = status.action !== null && blockers.length === 0;
  const verdict =
    autoMergeAction.kind === "disable" && line !== null ? line : verdictOf(line, blockers);
  const updateInFooter = insight.canUpdateBranch && !blockers.some(({ code }) => code === "behind");
  const footer =
    controls !== null &&
    (status.action !== null || autoMergeAction.kind === "enable" || updateInFooter);
  return (
    <section
      aria-label="Merge status"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background transition-colors duration-300",
        ready ? "border-success/40" : "border-border",
      )}
    >
      <div
        role="status"
        aria-label="Merge verdict"
        className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-sm"
      >
        <Icon
          key={verdict.text}
          name={verdict.icon}
          className={cn(
            "size-4 shrink-0 duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] animate-in zoom-in-50 fade-in motion-reduce:animate-none",
            verdict.iconClassName,
          )}
        />
        <span className={cn("min-w-0 flex-1 font-semibold", verdict.textClassName)}>
          {verdict.text}
        </span>
        {blockers.length > 0 && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {countOf(blockers.length, "blocker")}
          </span>
        )}
        {controls !== null && autoMergeAction.kind === "disable" && (
          <AutoMergeButton threadId={controls.threadId} pr={pr} action={autoMergeAction} />
        )}
      </div>
      {blockers.length > 0 && (
        <ul aria-label="Merge blockers" className="flex flex-col border-t border-border">
          {blockers.map((blocker) => {
            const checkStatus = CHECK_STATUS_OF_BLOCKER[blocker.code];
            return (
              <li
                key={blocker.code}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border/60 px-3 py-2 text-sm last:border-b-0"
              >
                {REVIEW_BLOCKERS.has(blocker.code) ? (
                  <>
                    <BlockerLabel blocker={blocker} />
                    {insight.reviewers.length > 0 && (
                      <div className="basis-full pl-6">
                        <ReviewerRows reviewers={insight.reviewers} />
                      </div>
                    )}
                  </>
                ) : checkStatus === undefined ? (
                  <>
                    <BlockerLabel blocker={blocker} />
                    <BlockerFix
                      code={blocker.code}
                      pr={pr}
                      canUpdateBranch={insight.canUpdateBranch}
                      controls={controls}
                    />
                  </>
                ) : (
                  <CheckBlocker
                    blocker={blocker}
                    checks={insight.checks.filter(({ status }) => status === checkStatus)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {footer && (
        <div className="flex flex-wrap items-start gap-2 border-t border-border px-3 py-2.5">
          {status.action !== null && (
            <MergeActionButton threadId={controls.threadId} pr={pr} action={status.action} />
          )}
          {autoMergeAction.kind === "enable" && (
            <AutoMergeButton threadId={controls.threadId} pr={pr} action={autoMergeAction} />
          )}
          {updateInFooter && (
            <BranchUpdateButton
              threadId={controls.threadId}
              pr={pr}
              onUpdated={controls.onBranchUpdated}
            />
          )}
        </div>
      )}
    </section>
  );
}

const CHECK_STATUS_OF_BLOCKER: Partial<Record<Blocker["code"], CheckStatus>> = {
  checks_failed: "failed",
  checks_running: "running",
  checks_waiting: "waiting",
};

function BlockerLabel({ blocker }: { blocker: Blocker }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      <Icon name="AlertCircle" className={cn("size-4 shrink-0", blockerTone(blocker.code))} />
      <span className="min-w-0 break-words">{blocker.text}</span>
    </span>
  );
}

function CheckBlocker({ blocker, checks }: { blocker: Blocker; checks: readonly Check[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className="-mx-1 flex min-w-0 flex-1 items-center gap-3 rounded-sm px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => setOpen((shown) => !shown)}
      >
        <BlockerLabel blocker={blocker} />
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {open ? "Hide checks" : "Show checks"}
          <Icon
            name="ChevronDown"
            aria-hidden="true"
            className={cn(
              "size-3 transition-transform duration-200 motion-reduce:transition-none",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div
          id={listId}
          className="basis-full pl-6 duration-200 ease-out animate-in fade-in slide-in-from-top-1 motion-reduce:animate-none"
        >
          <CheckRows checks={checks} />
        </div>
      )}
    </>
  );
}

const DRAFT_VERDICT: StatusRow = {
  text: "Draft, not ready for review",
  icon: "GitPullRequestDraft",
  iconClassName: "text-muted-foreground",
};

function verdictOf(line: SummaryLine | null, blockers: readonly Blocker[]): StatusRow {
  if (blockers.length > 0) {
    const blocking = blockers.some(({ code }) => blockerTone(code) === "text-destructive");
    return {
      text: "Can't merge yet",
      icon: blocking ? "CircleX" : "AlertCircle",
      iconClassName: blocking ? "text-destructive" : "text-attention",
    };
  }
  return line ?? DRAFT_VERDICT;
}

const LINK_ACTION =
  "-mx-1.5 inline-flex min-h-7 shrink-0 items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function BlockerFix({
  code,
  pr,
  canUpdateBranch,
  controls,
}: {
  code: Blocker["code"];
  pr: PrInsight["pr"];
  canUpdateBranch: boolean;
  controls: ThreadControls | null;
}) {
  const showFiles = useShowFiles();
  if (code === "conflicts") {
    return (
      <UrlLink href={`${pr.url}/conflicts`} className={LINK_ACTION}>
        Resolve on GitHub
        <Icon name="ArrowUpRight" aria-hidden="true" className="size-3" />
      </UrlLink>
    );
  }
  if (controls === null) return null;
  switch (code) {
    case "behind":
      return canUpdateBranch ? (
        <BranchUpdateButton
          threadId={controls.threadId}
          pr={pr}
          onUpdated={controls.onBranchUpdated}
        />
      ) : null;
    case "unresolved_threads":
      return (
        <button type="button" className={LINK_ACTION} onClick={() => showFiles({ commentIds: [] })}>
          Open in Files
          <Icon name="ChevronRight" aria-hidden="true" className="size-3" />
        </button>
      );
    default:
      return null;
  }
}

function DataAge({ refreshedAt, updating }: { refreshedAt: number; updating: boolean }) {
  const readAt = new Date(refreshedAt);
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {updating && (
        <span role="status" aria-label="Updating">
          <Icon name="Spinner" className="size-3 text-muted-foreground" />
        </span>
      )}
      Updated{" "}
      <time dateTime={readAt.toISOString()} title={readAt.toLocaleString()}>
        {relativeTime(readAt, new Date())}
      </time>
    </span>
  );
}

const GROUP_HEADING_CLASS = "text-xs font-medium text-muted-foreground";

const LABEL_CLASS =
  "shrink-0 rounded-full border border-border px-1.5 py-px text-[11px] leading-4 text-muted-foreground";

const REVIEWER_STATE_ICON: Record<Reviewer["state"], { name: IconName; className: string }> = {
  pending: { name: "Circle", className: "text-attention" },
  approved: { name: "CircleCheck", className: "text-success" },
  changes_requested: { name: "CircleX", className: "text-destructive" },
  commented: { name: "MessageSquare", className: "text-muted-foreground" },
  dismissed: { name: "Unavailable", className: "text-muted-foreground" },
};

function ReviewerList({ reviewers }: { reviewers: readonly Reviewer[] }) {
  if (reviewers.length === 0) return null;
  return (
    <OverviewSection label="Reviewers" summary={reviewers.length}>
      <OverviewCard>
        <ReviewerRows reviewers={reviewers} />
      </OverviewCard>
    </OverviewSection>
  );
}

function ReviewerRows({ reviewers }: { reviewers: readonly Reviewer[] }) {
  return (
    <ul aria-label="Reviewers" className="flex flex-col gap-0.5">
      {reviewers.map((reviewer) => {
        const icon = REVIEWER_STATE_ICON[reviewer.state];
        return (
          <li key={reviewerKey(reviewer)} className="flex min-w-0 items-center gap-2 py-1 text-sm">
            <Icon
              name={icon.name}
              aria-hidden="true"
              className={cn("size-4 shrink-0", icon.className)}
            />
            <span className="min-w-0 truncate">
              {reviewer.kind === "team" ? `${reviewer.name} (team)` : reviewer.name}
            </span>
            {reviewer.codeOwner && <span className={LABEL_CLASS}>code owner</span>}
            <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
              {REVIEWER_STATE_LABEL[reviewer.state]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const CHECK_SUMMARY_ORDER: readonly CheckStatus[] = [
  "failed",
  "cancelled",
  "waiting",
  "running",
  "passed",
  "skipped",
];

function checkSummary(checks: readonly Check[]): string {
  return CHECK_SUMMARY_ORDER.flatMap((status) => {
    const count = checks.filter((check) => check.status === status).length;
    return count === 0 ? [] : [`${count} ${status}`];
  }).join(" · ");
}

function CheckList({
  checks,
  shownInCard,
}: {
  checks: readonly Check[];
  shownInCard: ReadonlySet<CheckStatus>;
}) {
  if (checks.length === 0) {
    return (
      <OverviewSection label="Checks">
        <p className="text-sm text-muted-foreground">No checks on the head commit</p>
      </OverviewSection>
    );
  }
  const byStatus = (status: CheckStatus) => checks.filter((check) => check.status === status);
  return (
    <OverviewSection label="Checks" summary={checkSummary(checks)}>
      <OverviewCard>
        {OPEN_STATUSES.filter((status) => !shownInCard.has(status)).map((status) => {
          const group = byStatus(status);
          if (group.length === 0) return null;
          return (
            <div key={status}>
              <h4 className={GROUP_HEADING_CLASS}>
                <span data-testid="check-group-heading" className="tabular-nums">
                  {group.length} {status}
                </span>
              </h4>
              <CheckRows checks={group} />
            </div>
          );
        })}
        <CollapsedChecks groups={COLLAPSED_STATUSES.map((status) => [status, byStatus(status)])} />
      </OverviewCard>
    </OverviewSection>
  );
}

function CollapsedChecks({
  groups,
}: {
  groups: readonly (readonly [CheckStatus, readonly Check[]])[];
}) {
  const [open, setOpen] = useState(false);
  const shown = groups.filter(([, group]) => group.length > 0);
  if (shown.length === 0) return null;
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary
        className={cn(
          GROUP_HEADING_CLASS,
          "flex w-fit cursor-pointer list-none items-center gap-1 select-none rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        )}
      >
        <Icon name={open ? "ChevronDown" : "ChevronRight"} className="size-3.5" />
        <span data-testid="check-group-heading" className="tabular-nums">
          {shown.map(([status, group]) => `${group.length} ${status}`).join(", ")}
        </span>
      </summary>
      {shown.map(([status, group]) => (
        <CheckRows key={status} checks={group} />
      ))}
    </details>
  );
}

function CheckRows({ checks }: { checks: readonly Check[] }) {
  return (
    <ul className="mt-1 flex flex-col">
      {checks.map((check) => (
        <CheckRow key={check.name} check={check} />
      ))}
    </ul>
  );
}

function CheckRow({ check }: { check: Check }) {
  const icon = STATUS_ICON[check.status];
  return (
    <li className="flex min-w-0 flex-col gap-1 py-1 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name={icon.name} className={cn("size-4 shrink-0", icon.className)} />
        {check.url === null ? (
          <span className="truncate">{check.name}</span>
        ) : (
          <UrlLink href={check.url} className="truncate underline-offset-2 hover:underline">
            {check.name}
          </UrlLink>
        )}
        {check.required && <span className={LABEL_CLASS}>required</span>}
      </div>
      {check.failure !== null && <CheckFailureDetail failure={check.failure} />}
    </li>
  );
}

function CheckFailureDetail({ failure }: { failure: CheckFailure }) {
  const hiddenCount = failure.annotationCount - failure.annotations.length;
  const reasonRepeated = failure.annotations.some(({ message }) => message === failure.reason);
  return (
    <div className="flex min-w-0 flex-col gap-1 pl-6 text-xs text-muted-foreground">
      {failure.reason !== "" && !reasonRepeated && (
        <p data-testid="check-reason" className="line-clamp-3 break-words">
          {failure.reason}
        </p>
      )}
      {failure.annotations.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {failure.annotations.map((annotation, index) => (
            <li key={index} data-testid="check-annotation" className="min-w-0 break-words">
              <span className="font-mono">
                {annotation.path}:{annotation.line}
              </span>{" "}
              {annotation.message}
            </li>
          ))}
        </ul>
      )}
      {hiddenCount > 0 && <p>{hiddenCount} more</p>}
    </div>
  );
}
