import { UrlLink } from "@get-bb/plugin-sdk/app";
import { assessSession, formatDuration, type LiveSession } from "../advice";
import { formatMoney, formatShare, formatTokens } from "../format";
import type { Dashboard } from "../rpc";
import { Panel } from "./Panel";
import { useLiveSessions, useNow } from "./useLiveSessions";

const BAND_LABELS: Record<Dashboard["byContextBand"][number]["band"], string> = {
  under100k: "Under 100K",
  "100kTo250k": "100K to 250K",
  "250kTo500k": "250K to 500K",
  over500k: "Over 500K",
};

const LIVE_ROWS = 10;

function color(variable: string, fallback: string): string {
  return `var(${variable}, ${fallback})`;
}

function cacheState(session: LiveSession, now: number): string {
  const advice = assessSession(session, now);
  if (advice.warmRemainingMs > 0) return `Cache warm, ${formatDuration(advice.warmRemainingMs)} left`;
  return `Cache expired ${formatDuration(advice.idleMs)} after last reply`;
}

export function LivePanel() {
  const { value } = useLiveSessions();
  const now = useNow(5_000);
  const sessions = value?.sessions.slice(0, LIVE_ROWS) ?? [];
  if (sessions.length === 0) return null;
  return (
    <Panel title="Recent sessions" aside={<span>What the next message costs in each</span>}>
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-1 font-medium">Session</th>
            <th className="w-20 py-1 text-right font-medium">Context</th>
            <th className="w-64 py-1 pl-4 font-medium">Cache</th>
            <th className="w-28 py-1 text-right font-medium">Next message</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => {
            const advice = assessSession(session, now);
            const cold = advice.warmRemainingMs === 0;
            const nextCost = cold ? session.recacheCost : session.warmCallCost;
            return (
              <tr key={session.path} className="border-t border-border align-top">
                <td className="py-1.5 pr-3">
                  <span className="block truncate">{session.threadTitle ?? session.title ?? "Untitled session"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {session.projectName ?? "Outside BB"}
                    {advice.level !== "none" ? ` · ${advice.headline}` : ""}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatTokens(session.context)}
                </td>
                <td className="py-1.5 pl-4 text-xs text-muted-foreground">{cacheState(session, now)}</td>
                <td
                  className={`py-1.5 text-right tabular-nums ${
                    advice.level === "cold" ? "font-medium text-destructive" : "text-muted-foreground"
                  }`}
                >
                  {formatMoney(nextCost)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

export function SplitPanel({ dashboard }: { dashboard: Dashboard }) {
  const split = dashboard.split;
  if (split.total <= 0) return null;
  const segments = [
    {
      key: "recache",
      label: "Re-caching after a pause",
      value: split.recache,
      fill: color("--chart-5", "#ef4444"),
    },
    { key: "cacheRead", label: "Re-reading the conversation", value: split.cacheRead, fill: color("--chart-1", "#3b82f6") },
    { key: "output", label: "New output", value: split.output, fill: color("--chart-3", "#f59e0b") },
    {
      key: "otherCacheWrite",
      label: "Caching new context",
      value: split.otherCacheWrite,
      fill: color("--chart-2", "#14b8a6"),
    },
    { key: "input", label: "Uncached input", value: split.input, fill: color("--chart-4", "#a855f7") },
  ].filter((segment) => segment.value > 0);
  const gaps = split.recacheByGap;
  return (
    <Panel title="Where the money went" aside={<span>30 days</span>}>
      <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label="Spend split by cause">
        {segments.map((segment) => (
          <div
            key={segment.key}
            style={{ width: `${(segment.value / split.total) * 100}%`, background: segment.fill }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
        {segments.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: segment.fill }} />
            {segment.label}
            <span className="tabular-nums">
              {formatMoney(segment.value)} · {formatShare(segment.value, split.total)}
            </span>
          </span>
        ))}
      </div>
      {split.recache > 0 ? (
        <p className="m-0 mt-3 text-sm">
          {formatMoney(split.recache)} ({formatShare(split.recache, split.total)}) went to writing a whole
          conversation to the prompt cache again after a pause. The cache lasts 5 minutes, so even short breaks
          count: {formatMoney(gaps["5to15m"])} came after pauses of 5 to 15 minutes, {formatMoney(gaps["15to60m"])}{" "}
          after 15 to 60 minutes, and {formatMoney(gaps.over60m)} after longer ones.
        </p>
      ) : null}
    </Panel>
  );
}

export function ContextBandPanel({ dashboard }: { dashboard: Dashboard }) {
  const bands = dashboard.byContextBand;
  const perCall = bands.map((band) => (band.calls > 0 ? band.total / band.calls : 0));
  const topPerCall = Math.max(0, ...perCall) || 1;
  return (
    <Panel title="Cost per call by context size" aside={<span>30 days</span>}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-1 font-medium">Context</th>
            <th className="py-1 text-right font-medium">Calls</th>
            <th className="py-1 text-right font-medium">Spend</th>
            <th className="w-2/5 py-1 pl-4 font-medium">Per call</th>
          </tr>
        </thead>
        <tbody>
          {bands.map((band, position) => (
            <tr key={band.band} className="border-t border-border">
              <td className="py-1.5">{BAND_LABELS[band.band]}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{band.calls.toLocaleString()}</td>
              <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatMoney(band.total)}</td>
              <td className="py-1.5 pl-4">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(perCall[position]! / topPerCall) * 100}%` }}
                    />
                  </div>
                  <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">
                    {formatMoney(perCall[position]!)}
                  </span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 mt-3 text-xs text-muted-foreground">
        Every call re-sends the whole conversation, so a call in a long thread costs several times one in a fresh
        thread. Starting a new thread per task keeps calls in the cheaper rows.
      </p>
    </Panel>
  );
}

function pullRequestLabel(url: string): string {
  const number = /\/pull\/(\d+)/.exec(url)?.[1];
  return number ? `#${number}` : "PR";
}

export function SessionsPanel({ dashboard }: { dashboard: Dashboard }) {
  const sessions = dashboard.topSessions;
  return (
    <Panel title="Most expensive sessions" aside={<span>30 days</span>}>
      {sessions.length === 0 ? (
        <p className="m-0 text-sm text-muted-foreground">No priced sessions recorded yet.</p>
      ) : (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 font-medium">Session</th>
              <th className="w-24 py-1 text-right font-medium">Spend</th>
              <th className="w-16 py-1 text-right font-medium">Calls</th>
              <th className="w-28 py-1 text-right font-medium">Peak context</th>
              <th className="w-36 py-1 text-right font-medium" title="Spent writing the conversation to the cache again after a pause">
                Re-caching
              </th>
              <th className="w-32 py-1 pl-4 font-medium">PRs</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.key} className="border-t border-border align-top">
                <td className="py-1.5 pr-3">
                  <span className="block truncate" title={session.title}>
                    {session.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {session.projectName ?? "Outside BB"}
                    {session.threadTitle && session.threadTitle !== session.title ? ` · ${session.threadTitle}` : ""}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatMoney(session.total)}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">{session.calls}</td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {formatTokens(session.peakContext)}
                </td>
                <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                  {session.recache > 0
                    ? `${formatMoney(session.recache)} · ${formatShare(session.recache, session.total)}`
                    : "–"}
                </td>
                <td className="py-1.5 pl-4 text-xs">
                  {session.pullRequests.length === 0
                    ? "–"
                    : session.pullRequests.map((url, position) => (
                        <span key={url}>
                          {position > 0 ? ", " : ""}
                          <UrlLink href={url} className="underline">
                            {pullRequestLabel(url)}
                          </UrlLink>
                        </span>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
