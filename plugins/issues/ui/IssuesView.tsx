import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { BoardCard } from "../core/board";
import { buildIssueThreadPrompt, issueUrl } from "../core/issueThread";
import { isSearchFocusKey, isTypingTarget } from "../core/searchHotkey";
import type { LabelUsage } from "../core/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Board } from "./Board";
import type { IssueActions } from "./Card";
import { CardDrawer } from "./CardDrawer";
import { ColumnSettingsDialog } from "./ColumnSettingsDialog";
import { CreateDialog } from "./CreateDialog";
import { useIssuesDrawer, useIssuesSearch, useValueFilter, type ValueOption } from "./useBoardView";
import type { IssuesRpc } from "./useIssuesBoard";
import { useIssuesBoard } from "./useIssuesBoard";

/** What the view needs from the host, injected so the view stays testable. */
export interface IssuesHost {
  openUrl: (url: string) => void;
  openThread: (threadId: string) => void;
  draftThread: (projectId: string, prompt: string) => void;
  copyText: (text: string) => Promise<boolean>;
}

const VALUE_OPTIONS: ValueOption[] = ["none", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

function CenteredState({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex h-full flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      {children}
    </div>
  );
}

function ValueFilterMenu({
  selected,
  onToggle,
  onClear,
}: {
  selected: ReadonlySet<ValueOption>;
  onToggle: (value: ValueOption) => void;
  onClear: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Filter by value">
          <Icon name="SlidersHorizontal" />
          Value{selected.size > 0 ? ` · ${selected.size}` : ""}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {VALUE_OPTIONS.map((value) => (
          <DropdownMenuCheckboxItem
            key={value}
            checked={selected.has(value)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => onToggle(value)}
          >
            {value === "none" ? "No value" : `Value ${value}`}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.size > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onClear}>Clear filter</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Shown when the board cannot load: the reason, a retry, and a way to name the repo. */
function LoadError({
  error,
  busy,
  onRetry,
  onSetRepo,
}: {
  error: string;
  busy: boolean;
  onRetry: () => void;
  onSetRepo: (repo: string) => void;
}) {
  const [repo, setRepo] = useState("");
  return (
    <CenteredState>
      <p className="m-0 text-sm font-medium text-foreground">No GitHub board for this project.</p>
      <p className="m-0 max-w-md text-sm text-muted-foreground">{error}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (repo.trim()) onSetRepo(repo.trim());
        }}
        className="mt-2 flex w-full max-w-sm items-center gap-2">
        <Input
          value={repo}
          placeholder="owner/name"
          aria-label="GitHub repository"
          onChange={(event) => setRepo(event.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !repo.trim()}>
          Use repository
        </Button>
      </form>
    </CenteredState>
  );
}

export function IssuesView({
  rpc,
  host,
  projectId,
  projectPicker,
}: {
  rpc: IssuesRpc;
  host: IssuesHost;
  projectId: string | null;
  projectPicker: ReactNode;
}) {
  const issues = useIssuesBoard(rpc, projectId);
  // The drawer and search read the unfiltered board: the drawer so paging through a
  // column's queue survives later query changes, search so it has the full set.
  const drawer = useIssuesDrawer(issues.board);
  const search = useIssuesSearch(issues.board);
  const valueFilter = useValueFilter(search.board);

  const [createLabels, setCreateLabels] = useState<string[] | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [columnConfig, setColumnConfig] = useState<{ labels: LabelUsage[]; columnLabels: string[] } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // A project switch closes everything that belonged to the previous board.
  const { close: closeDrawer } = drawer;
  const { clear: clearSearch } = search;
  const { clear: clearValueFilter } = valueFilter;
  useEffect(() => {
    closeDrawer();
    setCreateLabels(null);
    setColumnConfig(null);
    clearSearch();
    clearValueFilter();
  }, [projectId, closeDrawer, clearSearch, clearValueFilter]);

  const overlayOpen = drawer.open !== null || createLabels !== null || columnConfig !== null;

  // `/` focuses search from anywhere on the page unless something else takes typing
  // or a dialog is open. Esc inside search clears the query, then blurs.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isSearchFocusKey(event) && !overlayOpen && !isTypingTarget(event.target)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayOpen]);

  const repoSlug = issues.repoSlug;

  const copyLink = useCallback(
    async (issueNumber: number) => {
      if (!repoSlug) return;
      const copied = await host.copyText(issueUrl(repoSlug, issueNumber));
      if (copied) toast.success(`Copied link to #${issueNumber}`);
      else toast.error("Could not copy the link");
    },
    [host, repoSlug],
  );

  const { startThread } = issues;
  const actions: IssueActions = useMemo(
    () => ({
      repo: repoSlug,
      busy: issues.busy,
      onOpenUrl: host.openUrl,
      onCopyLink: (issueNumber) => void copyLink(issueNumber),
      onSetValue: (issueNumber, value) => void issues.setValue(issueNumber, value),
      onOpenThread: host.openThread,
      onStartThread: (card: BoardCard) => {
        void startThread(card).then((threadId) => {
          if (threadId) host.openThread(threadId);
        });
      },
      onDraftThread: (card: BoardCard) => {
        if (projectId && repoSlug) {
          host.draftThread(projectId, buildIssueThreadPrompt(repoSlug, card.issueNumber, card.title));
        }
      },
    }),
    [repoSlug, issues.busy, issues.setValue, host, copyLink, startThread, projectId],
  );

  function openCreate(labels: string[]) {
    setCreateLabels(labels);
    // Re-read on every open: the keys can change while the page stays mounted.
    rpc.call("issues_ai_status").then(
      (status) => setAiReady(status.ready),
      () => setAiReady(false),
    );
  }

  async function openColumns() {
    const config = await issues.loadColumnConfig();
    if (config) setColumnConfig(config);
  }

  async function closeOpenIssue() {
    const issueNumber = drawer.openIssueNumber;
    if (issueNumber === null) return;
    if (!(await issues.closeIssue(issueNumber))) return;
    // Advance before refreshing so the drawer does not land on the missing card.
    drawer.advancePastClosed(issueNumber);
    await issues.loadBoard();
  }

  const board = issues.board;
  const filtered = valueFilter.board;

  let body: ReactNode;
  if (!projectId) {
    body = (
      <CenteredState>
        <p className="m-0 text-sm text-muted-foreground">Select a project to view its issues.</p>
      </CenteredState>
    );
  } else if (!board && issues.isLoading) {
    body = (
      <CenteredState>
        <Icon name="Spinner" className="size-5 animate-spin text-muted-foreground" />
        <p className="m-0 text-sm text-muted-foreground">Loading board…</p>
      </CenteredState>
    );
  } else if (!board && issues.error) {
    body = (
      <LoadError
        error={issues.error}
        busy={issues.busy}
        onRetry={() => void issues.loadBoard()}
        onSetRepo={(repo) => void issues.setRepo(repo)}
      />
    );
  } else if (board && search.active && search.matchCount === 0) {
    body = (
      <CenteredState>
        <p className="m-0 text-sm text-muted-foreground">No issues match "{search.query}".</p>
        <Button variant="outline" size="sm" onClick={search.clear}>
          Clear search
        </Button>
      </CenteredState>
    );
  } else if (board && valueFilter.hasSelection && filtered && filtered.columns.every((c) => c.cards.length === 0)) {
    body = (
      <CenteredState>
        <p className="m-0 text-sm text-muted-foreground">No issues match the selected values.</p>
        <Button variant="outline" size="sm" onClick={valueFilter.clear}>
          Clear filter
        </Button>
      </CenteredState>
    );
  } else if (filtered) {
    body = (
      <Board
        columns={filtered.columns}
        terms={search.terms}
        actions={actions}
        onCardClick={drawer.openFrom}
        onAddCard={(label) => openCreate(label ? [label] : [])}
        onMoveCard={(issueNumber, from, to) => void issues.moveCard(issueNumber, from, to)}
        onRecolor={(name, color) => void issues.recolorLabel(name, color).catch(() => undefined)}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        {projectPicker}
        {repoSlug ? (
          <button
            type="button"
            className="truncate text-sm text-muted-foreground hover:text-foreground hover:underline"
            onClick={() => host.openUrl(`https://github.com/${repoSlug}/issues`)}
          >
            {repoSlug}
          </button>
        ) : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {board ? (
            <ValueFilterMenu
              selected={valueFilter.selected}
              onToggle={valueFilter.toggle}
              onClear={valueFilter.clear}
            />
          ) : null}
          <div className="relative flex items-center gap-2">
            <Icon
              name="Search"
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              value={search.query}
              placeholder="Search issues…"
              aria-label="Search issues"
              className="h-8 w-48 pl-8 text-sm"
              onChange={(event) => search.setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.preventDefault();
                if (search.query) search.clear();
                else event.currentTarget.blur();
              }}
            />
            {search.active ? (
              <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                {search.matchCount} of {search.totalCount}
              </span>
            ) : null}
          </div>
          <Button size="sm" disabled={!board || issues.busy} onClick={() => openCreate([])}>
            <Icon name="Plus" />
            Create
          </Button>
          <Button variant="outline" size="sm" disabled={!board || issues.busy} onClick={() => void openColumns()}>
            <Icon name="Columns2" />
            Columns
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Refresh"
            disabled={issues.isLoading || !projectId}
            onClick={() => void issues.loadBoard()}
          >
            <Icon name="RefreshCw" fallback="Spinner" className={cn(issues.isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {board && issues.error && !overlayOpen ? (
        <div role="alert" className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <span className="flex-1">{issues.error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={issues.clearError}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">{body}</div>

      {drawer.open && drawer.selectedCard && board ? (
        <CardDrawer
          card={drawer.selectedCard}
          allLabels={issues.repoLabels}
          index={drawer.open.index}
          total={drawer.open.issueNumbers.length}
          groupTitle={drawer.open.groupTitle}
          actions={actions}
          onPrev={() => drawer.go(-1)}
          onNext={() => drawer.go(1)}
          onClose={drawer.close}
          onSaveText={(title, text) =>
            drawer.openIssueNumber === null
              ? Promise.resolve(false)
              : issues.saveText(drawer.openIssueNumber, title, text)
          }
          onSetValue={(value) => {
            if (drawer.openIssueNumber !== null) void issues.setValue(drawer.openIssueNumber, value);
          }}
          onToggleLabel={(name, on) => {
            if (drawer.openIssueNumber !== null) void issues.toggleLabel(drawer.openIssueNumber, name, on);
          }}
          onCloseIssue={() => void closeOpenIssue()}
        />
      ) : null}

      {createLabels !== null && board ? (
        <CreateDialog
          labelOptions={issues.repoLabels}
          initialLabels={createLabels}
          busy={issues.busy}
          error={issues.error}
          aiReady={aiReady}
          onClose={() => setCreateLabels(null)}
          onCreate={(title, text, labels) => {
            void issues.createIssue(title, text, labels).then((created) => {
              if (created) setCreateLabels(null);
            });
          }}
          onRefine={issues.refineTicketDraft}
        />
      ) : null}

      {columnConfig !== null && board ? (
        <ColumnSettingsDialog
          repo={repoSlug}
          labels={columnConfig.labels}
          initialColumnLabels={columnConfig.columnLabels}
          busy={issues.busy}
          error={issues.error}
          onClose={() => {
            setColumnConfig(null);
            issues.clearError();
          }}
          onSave={(labels) => {
            void issues.saveColumns(labels).then((saved) => {
              if (saved) setColumnConfig(null);
            });
          }}
          onRecolor={issues.recolorLabel}
        />
      ) : null}
    </div>
  );
}
