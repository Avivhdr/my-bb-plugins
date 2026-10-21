import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { CHART_SERIES, dailyWindow } from "../dailyChartConfig";
import { formatDayLabel, formatMoney, formatShare, formatTokens } from "../format";
import type { Dashboard, rpcContract } from "../rpc";
import { DailySpendChart } from "./DailySpendChart";
import { usePolled } from "./usePolled";

type Figure = Dashboard["totals"]["today"];

function tokenCount(figure: Figure): number {
  const t = figure.tokens;
  return t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
}

function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        {aside ? <div className="flex items-center gap-2 text-xs text-muted-foreground">{aside}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function StatusBox({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}

function Totals({ dashboard }: { dashboard: Dashboard }) {
  const cards = [
    { label: "Today", figure: dashboard.totals.today },
    { label: "Last 7 days", figure: dashboard.totals.last7Days },
    { label: "Last 30 days", figure: dashboard.totals.last30Days },
    { label: "All recorded", figure: dashboard.totals.allTime },
  ];
  return (
    <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map(({ label, figure }) => (
        <div key={label} className="rounded-lg border border-border bg-card p-4">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(figure.total)}</div>
          <div className="mt-1 text-xs text-muted-foreground">{formatTokens(tokenCount(figure))} tokens</div>
        </div>
      ))}
    </section>
  );
}

function DailyPanel({ dashboard }: { dashboard: Dashboard }) {
  const [requestedWindowsBack, setRequestedWindowsBack] = useState(0);
  const shown = dailyWindow(dashboard.dailySeries, requestedWindowsBack);
  const peak = Math.max(0, ...shown.days.map((day) => day.total));
  const range = shown.days.length
    ? `${formatDayLabel(shown.days[0]!.day)} to ${formatDayLabel(shown.days.at(-1)!.day)}`
    : "";
  const allTime = dashboard.totals.allTime;
  return (
    <Panel
      title="Daily spend"
      aside={
        <>
          <span>{`${formatMoney(dashboard.runRatePerDay)}/day over the last 7 days · ${formatMoney(peak)} peak`}</span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Previous 30 days"
            disabled={!shown.hasOlder}
            onClick={() => setRequestedWindowsBack(shown.windowsBack + 1)}
          >
            <Icon name="ArrowLeft" aria-hidden />
          </Button>
          <span className="tabular-nums" aria-live="polite">
            {range}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label="Next 30 days"
            disabled={!shown.hasNewer}
            onClick={() => setRequestedWindowsBack(shown.windowsBack - 1)}
          >
            <Icon name="ArrowRight" aria-hidden />
          </Button>
        </>
      }
    >
      <DailySpendChart series={shown.days} label={`Daily spend from ${range}`} />
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
        {CHART_SERIES.map((entry) => (
          <span key={entry.key} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-sm"
              style={{ background: `var(${entry.cssVariable}, ${entry.fallback})` }}
            />
            {entry.label}
            <span className="tabular-nums">{formatShare(allTime.breakdown[entry.key], allTime.total)}</span>
          </span>
        ))}
      </div>
    </Panel>
  );
}

function ProjectsPanel({ dashboard }: { dashboard: Dashboard }) {
  const top = dashboard.byProject[0]?.total ?? 1;
  return (
    <Panel title="By project">
      {dashboard.byProject.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No priced spend recorded yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {dashboard.byProject.map((scope) => (
            <li key={scope.key} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{scope.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(scope.total)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${(scope.total / top) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ThreadsPanel({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Panel title="Top threads">
      {dashboard.byThread.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No thread-attributed spend recorded yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {dashboard.byThread.map((scope) => (
            <li key={scope.key} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate">{scope.label}</span>
                {scope.projectName ? (
                  <span className="block truncate text-xs text-muted-foreground">{scope.projectName}</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatMoney(scope.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ModelsPanel({ dashboard }: { dashboard: Dashboard }) {
  return (
    <Panel title="By model">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-1 font-medium">Model</th>
            <th className="py-1 text-right font-medium">Tokens</th>
            <th className="py-1 text-right font-medium">Spend</th>
            <th className="py-1 text-right font-medium">Share</th>
          </tr>
        </thead>
        <tbody>
          {dashboard.byModel.map((model) => (
            <tr key={model.model} className="border-t border-border">
              <td className="py-1.5">{model.model}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatTokens(model.tokens)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(model.total)}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                {formatShare(model.total, dashboard.totals.allTime.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function UnpricedBanner({ models }: { models: Dashboard["unpricedModels"] }) {
  return (
    <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
      Excluded from every figure below, because the price table has no rate for{" "}
      {models.map((unpriced, position) => (
        <span key={unpriced.model}>
          <strong>{unpriced.model}</strong> ({formatTokens(unpriced.tokens)} tokens)
          {position < models.length - 1 ? ", " : "."}
        </span>
      ))}
    </div>
  );
}

function DashboardBody({ dashboard }: { dashboard: Dashboard }) {
  if (dashboard.indexing) return <StatusBox>Reading Claude Code transcripts for the first time…</StatusBox>;
  if (dashboard.transcriptCount === 0) {
    return (
      <StatusBox>
        No Claude Code transcripts found in <code>~/.claude/projects</code>.
      </StatusBox>
    );
  }
  return (
    <>
      {dashboard.unpricedModels.length > 0 ? <UnpricedBanner models={dashboard.unpricedModels} /> : null}
      <Totals dashboard={dashboard} />
      <DailyPanel dashboard={dashboard} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ProjectsPanel dashboard={dashboard} />
        <ThreadsPanel dashboard={dashboard} />
      </div>
      <ModelsPanel dashboard={dashboard} />
      <p className="m-0 text-xs text-muted-foreground">
        Every figure is a lower bound: Claude Code transcripts leave out some billed usage, so actual spend can be
        higher. Priced at Anthropic list rates. Claude Code prunes transcripts after about a month; history already
        read stays here.
      </p>
    </>
  );
}

function subtitle(dashboard: Dashboard): string {
  const range = dashboard.earliestDay
    ? ` · ${formatDayLabel(dashboard.earliestDay)} to ${formatDayLabel(dashboard.latestDay ?? dashboard.earliestDay)}`
    : "";
  return `${dashboard.transcriptCount} transcripts indexed${range}`;
}

export function SpendDashboard() {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("dashboard"), [rpc]);
  const { value: dashboard, error, refresh } = usePolled(load);
  const [scanning, setScanning] = useState(false);
  const [rescanError, setRescanError] = useState<string | null>(null);

  const rescan = async () => {
    setScanning(true);
    try {
      await rpc.call("rescan");
      setRescanError(null);
      await refresh();
    } catch (cause) {
      setRescanError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setScanning(false);
    }
  };
  const shownError = rescanError ?? error;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border flex w-full max-w-6xl flex-col gap-6 px-4 pb-6 pt-3 md:px-5 md:pt-4">
        <div className="flex items-center justify-between gap-4">
          <p className="m-0 text-sm text-muted-foreground">{dashboard ? subtitle(dashboard) : null}</p>
          <Button size="sm" variant="outline" onClick={rescan} disabled={scanning}>
            {scanning ? "Scanning…" : "Rescan transcripts"}
          </Button>
        </div>
        {shownError !== null ? (
          <p role="alert" className="m-0 text-sm text-destructive">
            Cannot read usage: {shownError}
          </p>
        ) : null}
        {dashboard === null ? (
          error === null ? <StatusBox>Loading usage…</StatusBox> : null
        ) : (
          <DashboardBody dashboard={dashboard} />
        )}
      </div>
    </div>
  );
}
