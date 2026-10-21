import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Markdown } from "@get-bb/plugin-sdk/app";
import type { BoardCard } from "../core/board";
import { issueUrl } from "../core/issueThread";
import type { RepoLabel } from "../core/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LabelChip, SectionLabel, ValueGrid } from "./bits";
import type { IssueActions } from "./Card";

// The ways out of the open issue. All of them discard unsaved title/body text, so all
// of them route through the confirm when there is any.
type Exit = "prev" | "next" | "close";

function isTextField(element: Element | null): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  );
}

function DrawerPager({
  index,
  total,
  groupTitle,
  onPrev,
  onNext,
}: {
  index: number;
  total: number;
  groupTitle: string;
  onPrev: () => void;
  onNext: () => void;
}) {
  // Disabled rather than hidden in a group of one, so the header doesn't reflow.
  const alone = total <= 1;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        disabled={alone}
        aria-label={`Previous issue in ${groupTitle}`}
        onClick={onPrev}
      >
        <Icon name="ChevronLeft" />
      </Button>
      <span className="max-w-[24ch] truncate text-xs text-muted-foreground" title={groupTitle} aria-live="polite">
        {index + 1} of {total} · {groupTitle}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        disabled={alone}
        aria-label={`Next issue in ${groupTitle}`}
        onClick={onNext}
      >
        <Icon name="ChevronRight" />
      </Button>
    </div>
  );
}

export function CardDrawer({
  card,
  allLabels,
  index,
  total,
  groupTitle,
  actions,
  onPrev,
  onNext,
  onClose,
  onSaveText,
  onSetValue,
  onToggleLabel,
  onCloseIssue,
}: {
  card: BoardCard;
  allLabels: RepoLabel[];
  /** 0-based position of this card within its opened column. */
  index: number;
  total: number;
  groupTitle: string;
  actions: IssueActions;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  /** Resolves whether the save reached GitHub; Save & continue must not move on failure. */
  onSaveText: (title: string, body: string) => Promise<boolean>;
  onSetValue: (value: number | null) => void;
  onToggleLabel: (name: string, currentlyOn: boolean) => void;
  onCloseIssue: () => void;
}) {
  // Editable copies, re-seeded only when the open issue changes, so an in-progress
  // edit isn't clobbered by a board refresh.
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body ?? "");
  const [editingBody, setEditingBody] = useState(false);
  const [seededFor, setSeededFor] = useState(card.issueNumber);
  const [pending, setPending] = useState<Exit | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  if (card.issueNumber !== seededFor) {
    setSeededFor(card.issueNumber);
    setTitle(card.title);
    setBody(card.body ?? "");
    setEditingBody(false);
  }

  // After the confirm closes, focus returns to the drawer so ←/→ keep working.
  useEffect(() => {
    if (pending === null) contentRef.current?.focus();
  }, [pending]);

  const dirty = title !== card.title || body !== (card.body ?? "");
  const threadLink = card.threadLink;
  const busy = actions.busy;

  function run(exit: Exit) {
    if (exit === "prev") onPrev();
    else if (exit === "next") onNext();
    else onClose();
  }

  function request(exit: Exit) {
    if (dirty) setPending(exit);
    else run(exit);
  }

  function discardAndGo() {
    // Reset explicitly: when every other queue entry has left the board, stepping is a
    // no-op, the issue number never changes, and the re-seed above never fires.
    setTitle(card.title);
    setBody(card.body ?? "");
    setEditingBody(false);
    const exit = pending;
    setPending(null);
    if (exit) run(exit);
  }

  async function saveAndGo() {
    const exit = pending;
    const ok = await onSaveText(title.trim(), body);
    setPending(null);
    if (ok && exit) run(exit); // a failed save stays put; the page shows the error
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // The modifier bailout keeps Option+←/→ word-jump and Alt+← Back working.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (isTextField(document.activeElement)) return;
    event.preventDefault();
    request(event.key === "ArrowLeft" ? "prev" : "next");
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : request("close"))}>
      <DialogContent
        ref={contentRef}
        className="flex max-h-[85vh] max-w-2xl flex-col gap-0 p-0"
        hideCloseButton
        onKeyDown={handleKeyDown}
        onEscapeKeyDown={(event) => {
          // First Escape leaves a focused text field; the next one closes.
          const active = document.activeElement;
          if (isTextField(active)) {
            event.preventDefault();
            (active as HTMLElement).blur();
            contentRef.current?.focus();
          }
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <DrawerPager
              index={index}
              total={total}
              groupTitle={groupTitle}
              onPrev={() => request("prev")}
              onNext={() => request("next")}
            />
            <DialogTitle className="m-0 shrink-0 text-base font-semibold">#{card.issueNumber}</DialogTitle>
            <DialogDescription className="sr-only">Edit issue #{card.issueNumber}</DialogDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Open issue on GitHub"
              onClick={() => actions.onOpenUrl(issueUrl(actions.repo, card.issueNumber))}
            >
              <Icon name="ArrowUpRight" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Copy issue link"
              onClick={() => actions.onCopyLink(card.issueNumber)}
            >
              <Icon name="Copy" fallback="Paperclip" />
            </Button>
            {threadLink ? (
              <Button variant="outline" size="sm" onClick={() => actions.onOpenThread(threadLink.threadId)}>
                <Icon name="MessageSquare" />
                Open thread
              </Button>
            ) : null}
            <Button size="sm" disabled={busy} onClick={() => actions.onStartThread(card)}>
              <Icon name="Bot" />
              {threadLink ? "Start another thread" : "Start thread"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label="Close"
              onClick={() => request("close")}
            >
              <Icon name="X" />
            </Button>
          </div>
        </div>

        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
          <div className="flex flex-col gap-2">
            <SectionLabel htmlFor="issues-drawer-title">Title</SectionLabel>
            <Input id="issues-drawer-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <SectionLabel htmlFor="issues-drawer-body">Body</SectionLabel>
              <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setEditingBody((v) => !v)}>
                {editingBody ? "Preview" : "Edit"}
              </Button>
            </div>
            {editingBody ? (
              <Textarea
                id="issues-drawer-body"
                className="min-h-32"
                value={body}
                placeholder="Issue body…"
                onChange={(event) => setBody(event.target.value)}
              />
            ) : body.trim() ? (
              <div className="rounded-lg border border-border p-3 text-sm">
                <Markdown content={body} />
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">No description.</span>
            )}
            <Button
              size="sm"
              className="self-start"
              disabled={busy || !title.trim()}
              onClick={() => void onSaveText(title.trim(), body)}
            >
              Save title &amp; body
            </Button>
          </div>

          <div className="flex flex-col gap-2">
            <SectionLabel>Value</SectionLabel>
            <ValueGrid className="max-w-xs" current={card.value} disabled={busy} onPick={onSetValue} />
          </div>

          {card.parentIssueNumber !== null || card.subIssues.length > 0 || card.subIssuesSummary ? (
            <div className="flex flex-col gap-2">
              <SectionLabel>Sub-issues</SectionLabel>
              {card.parentIssueNumber !== null ? (
                <p className="m-0 text-sm text-muted-foreground">Parent issue #{card.parentIssueNumber}</p>
              ) : null}
              {card.subIssuesSummary ? (
                <p className="m-0 text-sm text-muted-foreground">
                  {card.subIssuesSummary.completed} of {card.subIssuesSummary.total} complete
                </p>
              ) : null}
              {card.subIssues.length > 0 ? (
                <ul className="m-0 flex flex-col gap-1 pl-4">
                  {card.subIssues.map((child) => (
                    <li key={child.issueNumber} className="text-sm">
                      #{child.issueNumber} {child.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <SectionLabel>Labels</SectionLabel>
            {allLabels.length === 0 ? (
              <span className="text-sm text-muted-foreground">No labels in this repo.</span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allLabels.map((label) => {
                  const on = card.labels.includes(label.name);
                  return (
                    <LabelChip
                      key={label.name}
                      name={label.name}
                      color={label.color}
                      on={on}
                      disabled={busy}
                      onToggle={() => onToggleLabel(label.name, on)}
                    />
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t border-border pt-3">
            <Button
              variant="outline"
              size="sm"
              className="border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={busy}
              onClick={onCloseIssue}
            >
              Close issue
            </Button>
          </div>
        </div>

        <AlertDialog open={pending !== null} onOpenChange={(open) => (open ? undefined : setPending(null))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>#{card.issueNumber} has unsaved changes</AlertDialogTitle>
              <AlertDialogDescription>Save the title and body before leaving, or discard them.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <Button variant="outline" onClick={discardAndGo}>
                Discard
              </Button>
              <AlertDialogAction
                autoFocus
                onClick={(event) => {
                  event.preventDefault();
                  void saveAndGo();
                }}
              >
                Save &amp; {pending === "close" ? "close" : "continue"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
