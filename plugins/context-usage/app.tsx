import { useCallback, useEffect, useState } from "react";
import * as HoverCard from "@radix-ui/react-hover-card";
import { definePluginApp, useRpc, type PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { formatTokenCount, type ContextUsage } from "./context";
import type { rpcContract } from "./server";

const POLL_MS = 5_000;

function useContextUsage(threadId: string): ContextUsage | null {
  const rpc = useRpc<typeof rpcContract>();
  const load = useCallback(() => rpc.call("contextUsage", { threadId }), [rpc, threadId]);
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      load()
        .then((value) => {
          if (active) setUsage(value);
        })
        .catch(() => {
          if (active) setUsage(null);
        });
    };
    refresh();
    const poll = setInterval(refresh, POLL_MS);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [load]);
  return usage;
}

function ContextPercent({ threadId }: PluginThreadHeaderActionProps) {
  const usage = useContextUsage(threadId);
  if (!usage) return null;
  const name = usage.estimated ? "Estimated context window" : "Context window";
  const label = `${name}, ${usage.percent}% used. ${formatTokenCount(usage.usedTokens)} of ${formatTokenCount(usage.windowTokens)} tokens.`;
  const tone =
    usage.percent >= 90
      ? "text-destructive"
      : usage.percent >= 80
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={`relative z-50 cursor-default px-2 text-xs tabular-nums [app-region:no-drag] [-webkit-app-region:no-drag] ${tone}`}
        >
          {usage.percent}%
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="bottom"
          align="end"
          sideOffset={8}
          className="z-50 w-56 rounded-md border border-border bg-card p-3 text-card-foreground shadow-md outline-none"
        >
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-muted-foreground">{name}</span>
            <span className={`font-medium tabular-nums ${tone}`}>{usage.percent}% used</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
            <div
              className={`h-full rounded-full ${usage.percent >= 90 ? "bg-destructive" : usage.percent >= 80 ? "bg-amber-600" : "bg-foreground"}`}
              style={{ width: `${usage.percent}%` }}
            />
          </div>
          <div className="mt-2 text-xs tabular-nums text-muted-foreground">
            {formatTokenCount(usage.usedTokens)} / {formatTokenCount(usage.windowTokens)} tokens
          </div>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_threadHeaderAction({
    id: "context-usage",
    title: "Context window",
    component: ContextPercent,
  });
});
