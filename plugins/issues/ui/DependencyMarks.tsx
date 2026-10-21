import type { IssueRelation } from "../core/board";
import { relationLabel, relationWindow, sameRepo } from "../core/dependency";
import { cn } from "@/lib/utils";

type Kind = "blocked" | "blocking";

const CHIP =
  "inline-flex max-w-48 items-center truncate rounded-full border px-1.5 text-[11px] font-medium leading-5";

// A blocked issue waits on others, so it gets the warning tint. An issue that only
// blocks others is not stuck itself, so its chips stay neutral.
const KIND_CLASS: Record<Kind, string> = {
  blocked: "border-warning/50 bg-warning/15 text-warning-text",
  blocking: "border-border bg-muted text-muted-foreground",
};

function relationName(relation: IssueRelation, kind: Kind, repo: string): string {
  const label = relationLabel(relation, repo);
  const title = relation.title ? ` ${relation.title}` : "";
  if (sameRepo(relation.repo, repo)) {
    return kind === "blocked"
      ? `Show ${label}${title}, which blocks this issue`
      : `Show ${label}${title}, which this issue blocks`;
  }
  return kind === "blocked"
    ? `Open ${label}${title} on GitHub. It blocks this issue.`
    : `Open ${label}${title} on GitHub. This issue blocks it.`;
}

function RelationChips({
  kind,
  relations,
  openCount,
  repo,
  onOpenUrl,
  onRevealIssue,
}: {
  kind: Kind;
  relations: IssueRelation[];
  openCount: number;
  repo: string;
  onOpenUrl: (url: string) => void;
  onRevealIssue: (issueNumber: number) => boolean;
}) {
  const { shown, extra } = relationWindow(relations, openCount);
  const lead = kind === "blocked" ? "Blocked by" : "Blocks";

  // A same-repo issue on the board scrolls into view; anything else opens on GitHub.
  function open(relation: IssueRelation) {
    if (sameRepo(relation.repo, repo) && onRevealIssue(relation.number)) return;
    onOpenUrl(relation.htmlUrl);
  }

  return (
    // Clicks here must not open the card. The buttons inside are the controls.
    <span
      className="inline-flex min-w-0 flex-wrap items-center gap-1"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {shown.length === 0 ? (
        <span className={cn(CHIP, KIND_CLASS[kind])}>
          {lead} {openCount}
        </span>
      ) : (
        <>
          <span className={cn(CHIP, KIND_CLASS[kind])}>{lead}</span>
          {shown.map((relation) => (
            <button
              key={`${relation.repo}#${relation.number}`}
              type="button"
              className={cn(
                CHIP,
                KIND_CLASS[kind],
                "cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              )}
              aria-label={relationName(relation, kind, repo)}
              title={relation.title || relationLabel(relation, repo)}
              onClick={() => open(relation)}
            >
              {relationLabel(relation, repo)}
            </button>
          ))}
          {extra > 0 ? (
            <span
              className={cn(CHIP, KIND_CLASS[kind])}
              title={kind === "blocked" ? `${extra} more blocking issues` : `${extra} more blocked issues`}
            >
              +{extra}
            </span>
          ) : null}
        </>
      )}
    </span>
  );
}

/** "Blocked by #3" and "Blocks #7" chips for one issue. Renders nothing without open links. */
export function DependencyMarks({
  card,
  repo,
  onOpenUrl,
  onRevealIssue,
}: {
  card: {
    blockedBy: IssueRelation[];
    blocking: IssueRelation[];
    blockedByOpenCount: number;
    blockingOpenCount: number;
  };
  repo: string;
  onOpenUrl: (url: string) => void;
  onRevealIssue: (issueNumber: number) => boolean;
}) {
  return (
    <>
      {card.blockedByOpenCount > 0 ? (
        <RelationChips
          kind="blocked"
          relations={card.blockedBy}
          openCount={card.blockedByOpenCount}
          repo={repo}
          onOpenUrl={onOpenUrl}
          onRevealIssue={onRevealIssue}
        />
      ) : null}
      {card.blockingOpenCount > 0 ? (
        <RelationChips
          kind="blocking"
          relations={card.blocking}
          openCount={card.blockingOpenCount}
          repo={repo}
          onOpenUrl={onOpenUrl}
          onRevealIssue={onRevealIssue}
        />
      ) : null}
    </>
  );
}
