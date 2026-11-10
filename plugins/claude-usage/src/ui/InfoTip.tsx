import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Icon } from "@/components/ui/icon";

/** An info icon whose explanation opens on hover or focus, in a portal so the composer cannot clip it. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            type="button"
            aria-label={label}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <Icon name="Info" className="size-3.5" aria-hidden />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            align="start"
            sideOffset={6}
            className="z-50 max-w-sm rounded-md border border-border bg-popover px-3 py-2 text-xs leading-relaxed text-popover-foreground shadow-md"
          >
            {children}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
