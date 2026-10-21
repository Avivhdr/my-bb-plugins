import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

export const BUTTON_CLASS =
  "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border disabled:cursor-default border-border px-2 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60";

export function RefreshButton({
  refreshing,
  refresh,
  className,
}: {
  refreshing: boolean;
  refresh: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(BUTTON_CLASS, className)}
      onClick={refresh}
      disabled={refreshing}
    >
      <Icon
        name="ArrowReloadHorizontal"
        className={cn("size-3.5", refreshing && "animate-spin motion-reduce:animate-none")}
      />
      {refreshing ? "Refreshing…" : "Refresh"}
    </button>
  );
}

interface SendToAgentButtonProps {
  count: number;
  sending: boolean;
  send: () => void;
}

export function SendToAgentButton({ count, sending, send }: SendToAgentButtonProps) {
  return (
    <button
      type="button"
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground shadow-[0_1px_1px_rgb(0_0_0/0.08)] transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60"
      onClick={send}
      disabled={count === 0 || sending}
    >
      <Icon name="Bot" className="size-3.5" />
      Send {count} to agent
    </button>
  );
}

interface RefreshErrorProps {
  message: string;
  refreshedAt: number | null;
  retry: () => void;
  busy: boolean;
}

export function RefreshError({ message, refreshedAt, retry, busy }: RefreshErrorProps) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <Icon name="AlertCircle" className="size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-col">
        <span className="break-words text-destructive">{message}</span>
        {refreshedAt !== null && (
          <span className="text-xs tabular-nums text-muted-foreground">
            Last updated{" "}
            <time dateTime={new Date(refreshedAt).toISOString()}>
              {new Date(refreshedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </time>
          </span>
        )}
      </div>
      <button type="button" className={cn(BUTTON_CLASS, "ml-auto")} onClick={retry} disabled={busy}>
        Retry
      </button>
    </div>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground"
    >
      {children}
    </div>
  );
}
