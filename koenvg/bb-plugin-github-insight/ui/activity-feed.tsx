import { useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { ActivityViewItem, ActivityViewPr, rpcContract } from "../contract";
import type { ActivityKind } from "../core/activity";
import type { PullRequestRef } from "../core/pr-ref";
import { relativeTime } from "../core/relative-time";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { Avatar } from "./avatar";
import { messageOf } from "./error-message";
import { Notice, RefreshButton, RefreshError } from "./feedback";
import { usePullRequestsNavigation } from "./pull-requests-routes";
import { ACTION_CLASS, ICON_ACTION_CLASS, LABEL_CLASS } from "./queue-styles";
import { useActivity } from "./use-activity";

const VERB: Record<ActivityKind, string> = {
  mention: "mentioned you",
  team_mention: "mentioned your team",
  reply: "replied",
  comment: "commented",
  changes_requested: "requested changes",
  approved: "approved",
  reviewed: "reviewed",
};

function verbOf(item: ActivityViewItem): string {
  return item.kind === "team_mention" && item.team !== null
    ? `mentioned @${item.team}`
    : VERB[item.kind];
}

function refOf({ repo, number }: { repo: string; number: number }): PullRequestRef {
  const [owner = "", name = ""] = repo.split("/");
  return { owner, repo: name, number };
}

function isSelected(pr: ActivityViewPr, selected: PullRequestRef | null): boolean {
  return (
    selected !== null &&
    `${selected.owner}/${selected.repo}`.toLowerCase() === pr.repo.toLowerCase() &&
    selected.number === pr.number
  );
}

/** The unread count on the Activity tab. */
export function ActivityTabBadge() {
  const unread = useActivity().view?.unread ?? 0;
  if (unread === 0) return null;
  return (
    <span
      data-testid="activity-unread"
      className="rounded-full bg-attention px-1.5 text-[11px] font-semibold leading-4 text-background tabular-nums"
    >
      {unread}
      <span className="sr-only"> unread</span>
    </span>
  );
}

/** Comments, replies, and mentions that need you, grouped by PR. A click opens the comment. */
export function ActivityFeed({ selected }: { selected: PullRequestRef | null }) {
  const { view, error, refreshing, refresh } = useActivity();
  const rpc = useRpc<typeof rpcContract>();
  const navigation = usePullRequestsNavigation();
  const [showRead, setShowRead] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function act(call: () => Promise<{ kind: "ok" } | { kind: "error"; message: string }>) {
    setActionError(null);
    const result = await call().catch((failure: unknown) => ({
      kind: "error" as const,
      message: messageOf(failure),
    }));
    if (result.kind === "error") setActionError(result.message);
  }

  function open(pr: ActivityViewPr, item: ActivityViewItem | null) {
    navigation.go({
      kind: "list",
      tab: "activity",
      selected: refOf(pr),
      focus: item === null ? null : { kind: item.place, commentId: item.id },
    });
    if (item !== null && !item.read)
      void act(() => rpc.call("markActivityRead", { ids: [item.id] }));
  }

  // The open PR keeps its read items, so the one you just opened stays in place.
  const prs = (view?.prs ?? [])
    .map((pr) =>
      showRead || isSelected(pr, selected)
        ? pr
        : { ...pr, items: pr.items.filter((item) => !item.read) },
    )
    .filter((pr) => pr.items.length > 0);
  const readCount = (view?.prs ?? []).reduce(
    (sum, pr) => sum + pr.items.filter((item) => item.read).length,
    0,
  );

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      {error !== null && (
        <RefreshError
          message={error}
          refreshedAt={view?.loadedAt ?? null}
          retry={refresh}
          busy={refreshing}
        />
      )}
      {actionError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {actionError}
        </p>
      )}
      {view === null ? (
        error === null && <Notice>Loading activity… The first load can take half a minute.</Notice>
      ) : (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              {view.unread === 0 ? "Nothing unread" : `${view.unread} unread`}
            </span>
            {readCount > 0 && (
              <button
                type="button"
                className={cn(ACTION_CLASS, "h-8 text-muted-foreground")}
                onClick={() => setShowRead((shown) => !shown)}
              >
                {showRead ? "Hide read" : `Show ${readCount} read`}
              </button>
            )}
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {view.unread > 0 && (
                <button
                  type="button"
                  className={cn(ACTION_CLASS, "h-8 text-muted-foreground")}
                  onClick={() => void act(() => rpc.call("markAllActivityRead", {}))}
                >
                  <Icon name="Check" className="size-3.5" />
                  Mark all read
                </button>
              )}
              <span className="text-xs tabular-nums text-subtle-foreground">
                Updated{" "}
                <time
                  dateTime={new Date(view.loadedAt).toISOString()}
                  title={new Date(view.loadedAt).toLocaleString()}
                >
                  {relativeTime(new Date(view.loadedAt), new Date())}
                </time>
              </span>
              <RefreshButton refreshing={refreshing} refresh={refresh} />
            </div>
          </div>
          {prs.length === 0 && (
            <Notice>
              No new comments, replies, or mentions on your pull requests or the ones you take part
              in.
            </Notice>
          )}
          {prs.map((pr) => (
            <ActivityPrGroup
              key={`${pr.repo}#${pr.number}`}
              pr={pr}
              selected={isSelected(pr, selected)}
              open={(item) => open(pr, item)}
              markPrRead={() =>
                void act(() => rpc.call("markActivityPrRead", { repo: pr.repo, number: pr.number }))
              }
              markRead={(item) => void act(() => rpc.call("markActivityRead", { ids: [item.id] }))}
              mute={(login) => void act(() => rpc.call("setActivityMuted", { login, muted: true }))}
            />
          ))}
          {view.muted.length > 0 && (
            <MutedPeople
              logins={view.muted}
              unmute={(login) =>
                void act(() => rpc.call("setActivityMuted", { login, muted: false }))
              }
            />
          )}
        </>
      )}
    </div>
  );
}

function ActivityPrGroup({
  pr,
  selected,
  open,
  markPrRead,
  markRead,
  mute,
}: {
  pr: ActivityViewPr;
  selected: boolean;
  open(item: ActivityViewItem | null): void;
  markPrRead(): void;
  markRead(item: ActivityViewItem): void;
  mute(login: string): void;
}) {
  const navigate = useBbNavigate();
  return (
    <section
      aria-label={`${pr.repo}#${pr.number}`}
      className="@container flex min-w-0 flex-col gap-1"
    >
      <div className="flex min-w-0 items-center gap-1.5 px-1 text-xs">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => open(null)}
        >
          <span className="min-w-0 truncate font-medium text-foreground" title={pr.title}>
            <span className="font-mono font-normal tabular-nums text-subtle-foreground">
              #{pr.number}
            </span>{" "}
            {pr.title}
          </span>
          <span className="hidden shrink-0 text-subtle-foreground @md:inline">{pr.repo}</span>
          {pr.mine && <span className={cn(LABEL_CLASS, "py-0")}>Your PR</span>}
          {pr.state !== "open" && (
            <span className={cn(LABEL_CLASS, "py-0")}>
              {pr.state === "merged" ? "Merged" : "Closed"}
            </span>
          )}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More actions for #${pr.number}`}
              className={cn(ICON_ACTION_CLASS, "size-7 pointer-coarse:size-9")}
            >
              <Icon name="MoreHorizontal" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => navigate.openUrl(pr.url)}>
              <Icon name="ExternalLink" className="size-3.5 shrink-0" />
              Open in GitHub
            </DropdownMenuItem>
            {pr.unread > 0 && (
              <DropdownMenuItem onSelect={markPrRead}>
                <Icon name="Check" className="size-3.5 shrink-0" />
                Mark all read
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ul
        className={cn(
          "divide-y divide-border overflow-hidden rounded-lg border border-border bg-card",
          selected && "border-ring/60",
        )}
      >
        {pr.items.map((item) => (
          <ActivityRow
            key={item.id}
            item={item}
            open={() => open(item)}
            markRead={() => markRead(item)}
            mute={() => mute(item.actor)}
          />
        ))}
      </ul>
    </section>
  );
}

function ActivityRow({
  item,
  open,
  markRead,
  mute,
}: {
  item: ActivityViewItem;
  open(): void;
  markRead(): void;
  mute(): void;
}) {
  const navigate = useBbNavigate();
  return (
    <li
      aria-label={`${item.actor} ${verbOf(item)}`}
      className="flex min-w-0 items-center gap-1 pr-1.5 transition-colors duration-150 hover:bg-state-hover hover:duration-0"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 self-stretch py-2 pl-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={open}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            item.read ? "bg-transparent" : "bg-attention",
          )}
        />
        <Avatar login={item.actor} url={item.actorAvatarUrl} labelled />
        <span
          className={cn("min-w-0 flex-1 truncate text-sm", item.read && "text-muted-foreground")}
        >
          <span className="font-medium">{item.actor}</span>{" "}
          <span className="text-muted-foreground">{verbOf(item)}</span>
          {item.snippet !== "" && (
            <>
              <span aria-hidden="true" className="text-subtle-foreground">
                {" "}
                ·{" "}
              </span>
              <span title={item.snippet}>{item.snippet}</span>
            </>
          )}
        </span>
        {!item.read && <span className="sr-only">Unread</span>}
        <time
          dateTime={item.at}
          title={new Date(item.at).toLocaleString()}
          className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground"
        >
          {relativeTime(new Date(item.at), new Date())}
        </time>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="More actions"
            className={cn(ICON_ACTION_CLASS, "size-8 pointer-coarse:size-10")}
          >
            <Icon name="MoreHorizontal" className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => navigate.openUrl(item.url)}>
            <Icon name="ExternalLink" className="size-3.5 shrink-0" />
            Open in GitHub
          </DropdownMenuItem>
          {!item.read && (
            <DropdownMenuItem onSelect={markRead}>
              <Icon name="Check" className="size-3.5 shrink-0" />
              Mark read
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={mute}>
            <Icon name="EyeOff" className="size-3.5 shrink-0" />
            Mute {item.actor}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function MutedPeople({
  logins,
  unmute,
}: {
  logins: readonly string[];
  unmute(login: string): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className={cn(ACTION_CLASS, "h-8 self-start text-muted-foreground")}>
          <Icon name="EyeOff" className="size-3.5" />
          {logins.length} muted
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {logins.map((login) => (
          <DropdownMenuItem key={login} onSelect={() => unmute(login)}>
            <Icon name="Eye" className="size-3.5 shrink-0" />
            Unmute {login}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
