import { useBbNavigate, useComposer } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { MergeActionButton, MergeConfirmation } from "./merge-action-button";
import { prStatusView, type StatusRow } from "./pr-status-view";
import { RefreshError } from "./feedback";
import { useInsight } from "./use-insight";
import { usePaletteMerge } from "./use-palette-merge";
import { openPrOverview, usePrPanelNavigation } from "./use-pr-panel-navigation";
import { useReportThreadOpened } from "./use-report-thread-opened";
import { PR_ACTION_BUSY_LABEL } from "./pr-operations";

const TEXT_BUTTON_CLASS =
  "flex min-h-8 min-w-0 flex-1 items-center gap-1.5 px-3 py-1.5 text-left text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

export function ComposerBanner() {
  const { scope } = useComposer();
  if (scope.kind !== "thread") return null;
  return <ThreadBanner key={scope.threadId} threadId={scope.threadId} />;
}

function ThreadBanner({ threadId }: { threadId: string }) {
  usePrPanelNavigation(threadId);
  useReportThreadOpened(threadId);
  const insight = useInsight(threadId);
  const palette = usePaletteMerge(threadId, insight);
  const navigate = useBbNavigate();
  const { result, refreshing, refresh } = insight;
  const { state, operation } = palette;
  const running = operation.kind === "running";
  const progress = running ? PR_ACTION_BUSY_LABEL[operation.action] : null;
  const preparing = state.kind === "preparing";
  const message =
    state.kind === "message"
      ? state.message
      : operation.kind === "error"
        ? operation.message
        : null;
  const openPrTab = () => openPrOverview(navigate, threadId);

  function normalBanner() {
    if (result?.kind !== "ok") {
      if (preparing) return <BannerStatus text="Loading pull request…" />;
      if (result === null) return <BannerStatus text={progress ?? "Loading pull request…"} />;
      return progress ? <BannerStatus text={progress} /> : null;
    }
    const normal = prStatusView(result.insight);
    const busyText = progress ?? (preparing ? "Loading pull request…" : null);
    const detail = busyText
      ? { text: busyText, icon: "Spinner", iconClassName: "text-muted-foreground" }
      : normal.detail;
    return (
      <div className="flex min-w-0 items-center gap-2 pr-1">
        <BannerText
          lifecycle={normal.lifecycle}
          detail={detail}
          busy={busyText !== null}
          onClick={openPrTab}
        />
        {normal.action !== null && (
          <MergeActionButton
            threadId={threadId}
            pr={result.insight.pr}
            action={normal.action}
            size="compact"
            disabled={state.kind === "confirm" || preparing}
            showError={false}
          />
        )}
        {refreshing && !preparing && !running && (
          <span
            role="status"
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
          >
            <Icon
              name="Spinner"
              aria-hidden="true"
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Refreshing…
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      {normalBanner()}
      {result?.kind === "error" && (
        <div className="px-3 py-1.5">
          <RefreshError
            message={result.message}
            refreshedAt={null}
            retry={refresh}
            busy={refreshing}
          />
        </div>
      )}
      {result?.kind === "ok" && result.error !== null && (
        <div className="px-3 py-1.5">
          <RefreshError
            message={result.error}
            refreshedAt={result.refreshedAt}
            retry={refresh}
            busy={refreshing}
          />
        </div>
      )}
      {message && (
        <div className="flex min-w-0 items-start gap-2 px-3 py-1.5">
          <p role="alert" className="min-w-0 flex-1 break-words text-xs text-destructive">
            {message}
          </p>
          <button
            type="button"
            aria-label="Dismiss merge message"
            onClick={palette.dismiss}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Icon name="X" aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      )}
      {state.kind === "confirm" && state.target.action.kind === "merge" && (
        <MergeConfirmation
          pr={state.target.pr}
          method={state.target.action.method}
          running={running}
          open
          onOpenChange={(open) => {
            if (!open) palette.dismiss();
          }}
          confirm={palette.confirm}
        />
      )}
    </>
  );
}

function BannerStatus({ text }: { text: string }) {
  return (
    <div
      role="status"
      className="flex min-h-8 w-full min-w-0 items-center gap-1.5 px-3 py-1.5 text-xs"
    >
      <Icon
        name="Spinner"
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
      />
      <span className="truncate">{text}</span>
    </div>
  );
}

interface BannerTextProps {
  lifecycle: StatusRow;
  detail: StatusRow | null;
  busy: boolean;
  onClick: () => void;
}

function BannerText({ lifecycle, detail, busy, onClick }: BannerTextProps) {
  const icon = detail ?? lifecycle;
  return (
    <button
      type="button"
      className={TEXT_BUTTON_CLASS}
      aria-label={detail === null ? lifecycle.text : `${lifecycle.text}: ${detail.text}`}
      onClick={onClick}
    >
      <Icon
        name={icon.icon}
        aria-hidden="true"
        className={cn(
          "size-3.5 shrink-0",
          icon.iconClassName,
          busy && "animate-spin motion-reduce:animate-none",
        )}
      />
      <span className={cn("shrink-0 whitespace-nowrap", lifecycle.iconClassName)}>
        {lifecycle.text}
      </span>
      {detail !== null && (
        <>
          <span aria-hidden="true">·</span>
          <span role={busy ? "status" : undefined} className={cn("truncate", detail.textClassName)}>
            {detail.text}
          </span>
        </>
      )}
    </button>
  );
}
