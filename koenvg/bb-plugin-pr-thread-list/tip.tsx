import type { ReactNode } from "react";

const SIDE = { start: "left-0", end: "right-0" };

export function Tip({
  text,
  side = "start",
  className = "",
  children,
}: {
  text: string;
  side?: keyof typeof SIDE;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={`group/tip relative ${className}`}>
      {children}
      <span
        aria-hidden
        data-tip=""
        className={`pointer-events-none absolute bottom-full z-30 mb-1 w-max max-w-56 whitespace-pre-line rounded-md border border-border bg-popover px-2 py-1 text-left text-[11px] font-normal leading-snug text-popover-foreground opacity-0 shadow-md transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100 ${SIDE[side]}`}
      >
        {text}
      </span>
    </span>
  );
}
