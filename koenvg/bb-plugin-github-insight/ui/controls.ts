import { cn } from "@/lib/utils";

const BUTTON_BASE =
  "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";
export const PRIMARY_BUTTON = cn(
  BUTTON_BASE,
  "bg-primary text-primary-foreground shadow-[0_1px_1px_rgb(0_0_0/0.08)] hover:bg-primary/90",
);
export const SECONDARY_BUTTON = cn(
  BUTTON_BASE,
  "border border-border bg-background hover:bg-muted",
);
export const QUIET_BUTTON = cn(
  BUTTON_BASE,
  "text-muted-foreground hover:bg-muted hover:text-foreground",
);

export const TEXTAREA =
  "max-h-64 min-h-14 w-full resize-none rounded-md border bg-background px-2.5 py-1.5 text-sm leading-relaxed transition-[border-color,box-shadow] [field-sizing:content] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20 disabled:opacity-60";

export const JUMPED_RING = "data-[jumped]:ring-2 data-[jumped]:ring-ring/70";
