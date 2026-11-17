import type { ReactNode } from "react";

/** A centered reading column for the text parts of the PR view. */
export const READABLE_COLUMN = "mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-6 px-4";

export function OverviewSection({
  label,
  summary,
  children,
}: {
  label: string;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h3 className="flex min-w-0 items-baseline gap-2 text-xs font-semibold text-foreground">
        <span className="shrink-0">{label}</span>
        {summary !== undefined && (
          <span className="min-w-0 truncate font-normal text-muted-foreground tabular-nums">
            {summary}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}
