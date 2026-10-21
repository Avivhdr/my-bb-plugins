import { useId } from "react";
import { experimental_Diff as Diff } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import type { ReviewThread } from "../core/review-threads";
import { ReviewThreadCard } from "./review-thread";

export function OutdatedThreads({ threads }: { threads: readonly ReviewThread[] }) {
  const headingId = useId();
  if (threads.length === 0) return null;
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-b border-border px-3 py-2"
    >
      <h2
        id={headingId}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        <Icon name="Clock" className="size-3.5" />
        Outdated
      </h2>
      {threads.map((thread) => (
        <OutdatedThread key={thread.id} thread={thread} />
      ))}
    </section>
  );
}

function OutdatedThread({ thread }: { thread: ReviewThread }) {
  const snippet = thread.comments[0]?.diffHunk;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-mono" title={thread.path}>
          {thread.path}
        </span>
        <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-muted-foreground tabular-nums">
          {thread.originalLine === null ? "Line unknown" : `Line ${thread.originalLine}`}
        </span>
      </div>
      {snippet !== undefined && <Diff patch={snippet} path={thread.path} />}
      <ReviewThreadCard thread={thread} />
    </div>
  );
}
