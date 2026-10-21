import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Markdown, UrlLink, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract, TimelineResult } from "../contract";
import { countOf } from "../core/blockers";
import { relativeTime } from "../core/relative-time";
import {
  groupTimeline,
  mergeEvents,
  type PrDescription,
  type TimelineEntry,
  type TimelineEvent,
} from "../core/timeline";
import { Icon, type IconName } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { QUIET_BUTTON, SECONDARY_BUTTON } from "./controls";
import { messageOf } from "./error-message";
import { useShowFiles } from "./files-jump";
import { NewCommentGlowContext, useNewComment, useNewCommentGlowState } from "./new-comment-glow";
import "./new-comment.css";
import { OverviewSection } from "./overview-section";
import { PrCommentComposer } from "./pr-comment-composer";
import { SUCCESS_TEXT } from "./text-tones";

type LoadedPage = Extract<TimelineResult, { kind: "ok" }>;

interface Conversation {
  pr: Pick<LoadedPage, "prNodeId" | "locked" | "viewerCanUpdate">;
  description: PrDescription;
  events: TimelineEvent[];
  newCommentIds: readonly string[];
  olderCursor: string | null;
  olderLoaded: boolean;
}

const NO_NEW_COMMENTS: readonly string[] = [];

function prOf({ prNodeId, locked, viewerCanUpdate }: LoadedPage): Conversation["pr"] {
  return { prNodeId, locked, viewerCanUpdate };
}

function useTimeline(threadId: string, refreshedAt: number) {
  const rpc = useRpc<typeof rpcContract>();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [hasPr, setHasPr] = useState(true);
  const [readError, setReadError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const read = useCallback(
    (before: string | null): Promise<TimelineResult> =>
      rpc
        .call("getTimeline", { threadId, before })
        .catch((error: unknown): TimelineResult => ({ kind: "error", message: messageOf(error) })),
    [rpc, threadId],
  );

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    const page = await read(null);
    if (request !== latestRequest.current) return;
    setHasPr(page.kind !== "no_pr");
    setReadError(page.kind === "error" ? page.message : null);
    if (page.kind !== "ok") return;
    setConversation((current) => ({
      pr: prOf(page),
      description: page.description,
      events: mergeEvents(current?.events ?? [], page.events),
      newCommentIds: page.newCommentIds,
      olderCursor: current?.olderLoaded ? current.olderCursor : page.olderCursor,
      olderLoaded: current?.olderLoaded ?? false,
    }));
  }, [read]);

  useEffect(() => {
    void reload();
  }, [reload, refreshedAt]);

  async function loadOlder() {
    const cursor = conversation?.olderCursor ?? null;
    if (cursor === null) return;
    setLoadingOlder(true);
    setOlderError(null);
    const page = await read(cursor);
    setLoadingOlder(false);
    if (page.kind !== "ok") {
      setOlderError(page.kind === "error" ? page.message : "No pull request for this thread");
      return;
    }
    setConversation(
      (current) =>
        current && {
          ...current,
          events: mergeEvents(page.events, current.events),
          newCommentIds: page.newCommentIds,
          olderCursor: page.olderCursor,
          olderLoaded: true,
        },
    );
  }

  return { conversation, hasPr, readError, loadingOlder, olderError, reload, loadOlder };
}

type Timeline = ReturnType<typeof useTimeline>;

export function TimelineSections({
  threadId,
  refreshedAt,
  scrollRoot,
  between,
}: {
  threadId: string;
  refreshedAt: number;
  scrollRoot: RefObject<HTMLElement | null>;
  between?: ReactNode;
}) {
  const timeline = useTimeline(threadId, refreshedAt);
  return (
    <>
      <DescriptionSection timeline={timeline} />
      {between}
      <ConversationTimeline threadId={threadId} timeline={timeline} scrollRoot={scrollRoot} />
    </>
  );
}

function ConversationTimeline({
  threadId,
  timeline,
  scrollRoot,
}: {
  threadId: string;
  timeline: Timeline;
  scrollRoot: RefObject<HTMLElement | null>;
}) {
  const { conversation, readError } = timeline;
  const entries = useMemo(() => groupTimeline(conversation?.events ?? []), [conversation]);
  const glow = useNewCommentGlowState(
    threadId,
    conversation?.newCommentIds ?? NO_NEW_COMMENTS,
    scrollRoot,
  );
  if (!timeline.hasPr) return null;
  return (
    <OverviewSection label="Conversation" summary={conversationSummary(conversation?.events ?? [])}>
      {readError !== null && (
        <TimelineError message={readError} retry={() => void timeline.reload()} />
      )}
      {conversation === null ? (
        readError === null && <TimelineSkeleton />
      ) : (
        <>
          <NewCommentGlowContext.Provider value={glow}>
            <TimelineList
              older={
                conversation.olderCursor !== null && (
                  <button
                    type="button"
                    className={cn(QUIET_BUTTON, "-ml-2.5 self-start")}
                    disabled={timeline.loadingOlder}
                    onClick={() => void timeline.loadOlder()}
                  >
                    {timeline.loadingOlder ? "Loading older events…" : "Load older events"}
                  </button>
                )
              }
              entries={entries}
            />
          </NewCommentGlowContext.Provider>
          {timeline.olderError !== null && (
            <TimelineError message={timeline.olderError} retry={() => void timeline.loadOlder()} />
          )}
          {entries.length === 0 && (
            <div className="flex flex-col gap-0.5 rounded-lg border border-dashed border-border px-3 py-4 text-center">
              <p className="text-sm text-foreground">No conversation yet</p>
              <p className="text-xs text-muted-foreground">
                Comments and reviews from GitHub show here.
              </p>
            </div>
          )}
          <CommentBox pr={conversation.pr} threadId={threadId} onPosted={timeline.reload} />
        </>
      )}
    </OverviewSection>
  );
}

function conversationSummary(events: readonly TimelineEvent[]): string | undefined {
  const comments = events.filter(({ kind }) => kind === "comment").length;
  const reviews = events.filter(({ kind }) => kind === "review").length;
  const parts = [
    ...(comments > 0 ? [countOf(comments, "comment")] : []),
    ...(reviews > 0 ? [countOf(reviews, "review")] : []),
  ];
  return parts.length === 0 ? undefined : parts.join(" · ");
}

function TimelineSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">Loading conversation…</span>
      {[0, 1].map((row) => (
        <div
          key={row}
          aria-hidden="true"
          className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5"
        >
          <div className="flex items-center gap-1.5">
            <div className="size-4 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            <div className="h-3 w-28 animate-pulse rounded bg-muted motion-reduce:animate-none" />
          </div>
          <div className="ml-6 h-3 w-3/4 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

function CommentBox({
  pr,
  threadId,
  onPosted,
}: {
  pr: Conversation["pr"];
  threadId: string;
  onPosted: () => Promise<void>;
}) {
  if (pr.locked && !pr.viewerCanUpdate) {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Icon name="Unavailable" className="size-4" />
        This conversation is locked
      </p>
    );
  }
  return <PrCommentComposer threadId={threadId} prNodeId={pr.prNodeId} onPosted={onPosted} />;
}

function TimelineError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <Icon name="AlertCircle" className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 break-words">{message}</span>
      <button type="button" className={SECONDARY_BUTTON} onClick={retry}>
        Retry
      </button>
    </div>
  );
}

function TimelineList({ older, entries }: { older: ReactNode; entries: readonly TimelineEntry[] }) {
  return (
    <ol className="relative flex flex-col gap-3 before:absolute before:inset-y-3 before:left-[9.5px] before:w-px before:bg-border">
      {older && (
        <RailItem kind="older" icon="MoreHorizontal" tone="text-muted-foreground" onCard={false}>
          {older}
        </RailItem>
      )}
      {entries.map((entry) => {
        const marker = markerOf(entry);
        return (
          <RailItem
            key={entry.id}
            kind="event"
            icon={marker.icon}
            tone={marker.tone}
            onCard={hasCard(entry)}
          >
            <TimelineItem entry={entry} />
          </RailItem>
        );
      })}
    </ol>
  );
}

function RailItem({
  kind,
  icon,
  tone,
  onCard,
  children,
}: {
  kind: "older" | "event";
  icon: IconName;
  tone: string;
  onCard: boolean;
  children: ReactNode;
}) {
  return (
    <li data-rail-item={kind} className="relative min-w-0 pl-8">
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 flex size-5 items-center justify-center rounded-full border border-border bg-background",
          onCard ? "top-2" : "top-0",
        )}
      >
        <Icon name={icon} className={cn("size-3", tone)} />
      </span>
      {children}
    </li>
  );
}

function DescriptionSection({ timeline }: { timeline: Timeline }) {
  const { conversation, readError, hasPr } = timeline;
  if (!hasPr || (conversation === null && readError !== null)) return null;
  return (
    <OverviewSection label="Description">
      <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
        {conversation === null ? (
          <DescriptionSkeleton />
        ) : (
          <>
            <EventHeader actor={conversation.description.author} at={conversation.description.at}>
              opened this
            </EventHeader>
            <DescriptionBody body={conversation.description.body} />
          </>
        )}
      </div>
    </OverviewSection>
  );
}

const FOLDED_HEIGHT_PX = 320;

function DescriptionBody({ body }: { body: string }) {
  const content = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const element = content.current;
    if (element === null) return;
    const measure = () => setOverflows(element.scrollHeight > FOLDED_HEIGHT_PX + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body]);
  if (body.trim() === "") {
    return <p className="text-sm text-muted-foreground italic">No description provided.</p>;
  }
  const folded = overflows && !expanded;
  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "relative overflow-hidden",
          folded &&
            "max-h-80 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-16 after:bg-gradient-to-t after:from-background after:to-transparent",
        )}
      >
        <div ref={content}>
          <Body markdown={body} />
        </div>
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          className={cn(QUIET_BUTTON, "-ml-2.5 self-start")}
          onClick={() => setExpanded((shown) => !shown)}
        >
          {expanded ? "Show less" : "Show full description"}
          <Icon
            name="ChevronDown"
            aria-hidden="true"
            className={cn(
              "size-3.5 transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </button>
      )}
    </div>
  );
}

function DescriptionSkeleton() {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">Loading description…</span>
      <div
        aria-hidden="true"
        className="h-3 w-40 animate-pulse rounded bg-muted motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="h-3 w-full animate-pulse rounded bg-muted motion-reduce:animate-none"
      />
      <div
        aria-hidden="true"
        className="h-3 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none"
      />
    </div>
  );
}

function hasCard(entry: TimelineEntry): boolean {
  if (entry.kind === "comment") return true;
  return entry.kind === "review" && (entry.body !== "" || entry.inlineCount > 0);
}

function markerOf(entry: TimelineEntry): { icon: IconName; tone: string } {
  switch (entry.kind) {
    case "comment":
      return { icon: "MessageSquare", tone: "text-muted-foreground" };
    case "review": {
      const verdict = REVIEW_VERDICT[entry.state];
      return { icon: verdict.icon, tone: verdict.tone };
    }
    case "commits":
      return { icon: "GitBranch", tone: "text-muted-foreground" };
    default:
      return { icon: LIFECYCLE[entry.kind].icon, tone: "text-muted-foreground" };
  }
}

const REVIEW_VERDICT = {
  approved: { label: "Approved", icon: "CircleCheck", tone: "text-success", text: SUCCESS_TEXT },
  changes_requested: {
    label: "Changes requested",
    icon: "CircleX",
    tone: "text-destructive",
    text: "text-destructive",
  },
  commented: {
    label: "Commented",
    icon: "Eye",
    tone: "text-muted-foreground",
    text: "text-muted-foreground",
  },
  dismissed: {
    label: "Dismissed",
    icon: "Unavailable",
    tone: "text-muted-foreground",
    text: "text-muted-foreground",
  },
} as const satisfies Record<string, { label: string; icon: IconName; tone: string; text: string }>;

const LIFECYCLE = {
  ready_for_review: { text: "marked this ready for review", icon: "GitPullRequest" },
  closed: { text: "closed this", icon: "GitPullRequestClosed" },
  reopened: { text: "reopened this", icon: "GitPullRequest" },
  merged: { text: "merged this", icon: "GitMerge" },
} as const satisfies Record<string, { text: string; icon: IconName }>;

function TimelineItem({ entry }: { entry: TimelineEntry }) {
  switch (entry.kind) {
    case "comment":
      return (
        <CommentCard commentId={entry.id}>
          <EventHeader actor={entry.actor} at={entry.at} url={entry.url}>
            commented
          </EventHeader>
          <Body markdown={entry.body} />
        </CommentCard>
      );
    case "review":
      return <ReviewItem review={entry} />;
    case "commits":
      return <CommitGroup group={entry} />;
    default: {
      const { text } = LIFECYCLE[entry.kind];
      return (
        <EventHeader actor={entry.actor} at={entry.at}>
          {text}
        </EventHeader>
      );
    }
  }
}

function ReviewItem({ review }: { review: Extract<TimelineEntry, { kind: "review" }> }) {
  const showFiles = useShowFiles();
  const verdict = REVIEW_VERDICT[review.state];
  const hasDetail = review.body !== "" || review.inlineCount > 0;
  const header = (
    <EventHeader actor={review.actor} at={review.at} url={review.url}>
      <span className={cn("font-medium", verdict.text)}>{verdict.label}</span>
    </EventHeader>
  );
  if (!hasDetail) return header;
  const detail = (
    <>
      {header}
      {review.body !== "" && <Body markdown={review.body} />}
      {review.inlineCount > 0 && (
        <button
          type="button"
          className={cn(QUIET_BUTTON, "-ml-2.5 self-start")}
          onClick={() => showFiles({ commentIds: review.inlineCommentIds })}
        >
          <Icon name="MessageSquare" className="size-3.5" />
          {review.inlineCount === 1 ? "1 inline comment" : `${review.inlineCount} inline comments`}
        </button>
      )}
    </>
  );
  if (review.body === "") return <Card>{detail}</Card>;
  return <CommentCard commentId={review.id}>{detail}</CommentCard>;
}

function CommitGroup({ group }: { group: Extract<TimelineEntry, { kind: "commits" }> }) {
  const count = group.commits.length;
  return (
    <details className="group">
      <summary className="cursor-pointer list-none rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
        <EventHeader actor={group.actor} at={group.at}>
          added {count === 1 ? "1 commit" : `${count} commits`}
          <Icon
            name="ChevronRight"
            className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
          />
        </EventHeader>
      </summary>
      <ul className="mt-1 flex flex-col gap-0.5">
        {group.commits.map((commit) => (
          <li
            key={commit.id}
            data-testid="timeline-commit"
            className="flex min-w-0 gap-2 text-xs text-muted-foreground"
          >
            <span className="shrink-0 font-mono">{commit.oid.slice(0, 7)}</span>
            <span className="truncate text-foreground">{commit.headline}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

const CARD_CLASS =
  "flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-background px-3 py-2";

function Card({ children }: { children: ReactNode }) {
  return <div className={CARD_CLASS}>{children}</div>;
}

function CommentCard({ commentId, children }: { commentId: string; children: ReactNode }) {
  const { ref, glowing } = useNewComment(commentId);
  return (
    <div
      ref={ref}
      data-timeline-comment-id={commentId}
      className={cn(CARD_CLASS, glowing && "review-comment-new")}
    >
      {children}
    </div>
  );
}

function Body({ markdown }: { markdown: string }) {
  return (
    <div className="min-w-0 overflow-x-auto text-sm leading-relaxed break-words [contain:inline-size] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
      <Markdown content={markdown} />
    </div>
  );
}

function EventHeader({
  actor,
  at,
  url,
  children,
}: {
  actor: string | null;
  at: string;
  url?: string;
  children: ReactNode;
}) {
  const date = new Date(at);
  const time = (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
    >
      {relativeTime(date, new Date())}
    </time>
  );
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
      <span className="min-w-0 truncate font-semibold text-foreground">{actor ?? "ghost"}</span>{" "}
      <span className="inline-flex items-center gap-1 text-muted-foreground">{children}</span>{" "}
      {url === undefined ? (
        <span className="text-muted-foreground">{time}</span>
      ) : (
        <UrlLink
          href={url}
          className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {time}
        </UrlLink>
      )}
    </div>
  );
}
