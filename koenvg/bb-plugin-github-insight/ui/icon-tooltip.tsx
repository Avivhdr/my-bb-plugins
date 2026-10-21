import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function IconTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
