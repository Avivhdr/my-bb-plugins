import type { ReactNode } from "react";

export function Panel({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
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
