import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { countOf } from "../core/blockers";
import { peekIntent, useCommandIntent, type IntentOf } from "./command-intents";
import { ShowFilesProvider, type FilesJump, type FilesJumpRequest } from "./files-jump";
import { FilesTab } from "./files-tab";
import { ReportSummaryProvider, type PrTabSummary } from "./pr-tab-summary";
import { OverviewTab } from "./overview-tab";
import { rememberedSubTab, rememberSubTab, type PrSubTab } from "./pr-sub-tab";

const SUB_TABS: readonly { id: PrSubTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "files", label: "Files" },
];

const SUB_TAB_OF_INTENT: Record<IntentOf<"pr">, PrSubTab> = {
  "show-overview": "overview",
  "show-files": "files",
};

function initialSubTab(threadId: string): PrSubTab {
  const pending = peekIntent(threadId, "pr");
  return pending === null ? rememberedSubTab(threadId) : SUB_TAB_OF_INTENT[pending];
}

export function PrPanel({ threadId }: PluginThreadPanelProps) {
  return <PrPanelContent key={threadId} threadId={threadId} />;
}

function PrPanelContent({ threadId }: { threadId: string }) {
  const [selected, setSelected] = useState(() => initialSubTab(threadId));
  const [filesShown, setFilesShown] = useState(selected === "files");
  const select = useCallback(
    (subTab: PrSubTab) => {
      rememberSubTab(threadId, subTab);
      setSelected(subTab);
      if (subTab === "files") setFilesShown(true);
    },
    [threadId],
  );
  const [jump, setJump] = useState<FilesJump | null>(null);
  const showFiles = useCallback(
    (next: FilesJump) => {
      select("files");
      setJump(next);
    },
    [select],
  );
  const jumpRequest = useMemo<FilesJumpRequest | null>(
    () => jump && { ...jump, onHandled: () => setJump(null) },
    [jump],
  );
  useCommandIntent(threadId, "pr", (intent) => select(SUB_TAB_OF_INTENT[intent]));
  const [summary, setSummary] = useState<PrTabSummary | null>(null);
  const overviewScroll = useRef<HTMLDivElement>(null);
  const idPrefix = useId();
  const ids = (subTab: PrSubTab) => ({
    tab: `${idPrefix}-${subTab}-tab`,
    panel: `${idPrefix}-${subTab}-panel`,
  });
  return (
    <div className="flex h-full min-w-0 flex-col [contain:inline-size]">
      <SubTabBar
        selected={selected}
        select={select}
        ids={ids}
        filesShown={filesShown}
        summary={summary}
      />
      <SubTabPanel ids={ids("overview")} shown={selected === "overview"}>
        <div ref={overviewScroll} className="h-full overflow-y-auto px-4 py-4">
          <ShowFilesProvider value={showFiles}>
            <ReportSummaryProvider value={setSummary}>
              <OverviewTab threadId={threadId} scrollRoot={overviewScroll} />
            </ReportSummaryProvider>
          </ShowFilesProvider>
        </div>
      </SubTabPanel>
      {filesShown && (
        <SubTabPanel ids={ids("files")} shown={selected === "files"}>
          <FilesTab threadId={threadId} jump={jumpRequest} />
        </SubTabPanel>
      )}
    </div>
  );
}

interface SubTabIds {
  tab: string;
  panel: string;
}

function SubTabBar({
  selected,
  select,
  ids,
  filesShown,
  summary,
}: {
  selected: PrSubTab;
  select: (subTab: PrSubTab) => void;
  ids: (subTab: PrSubTab) => SubTabIds;
  filesShown: boolean;
  summary: PrTabSummary | null;
}) {
  const buttons = useRef(new Map<PrSubTab, HTMLButtonElement>());
  const filesDescriptionId = useId();
  function onKeyDown(event: KeyboardEvent) {
    const index = SUB_TABS.findIndex(({ id }) => id === selected);
    const target =
      event.key === "ArrowRight"
        ? SUB_TABS[(index + 1) % SUB_TABS.length]
        : event.key === "ArrowLeft"
          ? SUB_TABS[(index - 1 + SUB_TABS.length) % SUB_TABS.length]
          : event.key === "Home"
            ? SUB_TABS[0]
            : event.key === "End"
              ? SUB_TABS.at(-1)
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    select(target.id);
    buttons.current.get(target.id)?.focus();
  }
  return (
    <div className="shrink-0 border-b border-border px-4 py-2">
      <div
        role="tablist"
        aria-label="Pull request view"
        className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
        onKeyDown={onKeyDown}
      >
        {SUB_TABS.map(({ id, label }) => {
          const active = id === selected;
          return (
            <button
              key={id}
              ref={(element) => {
                if (element) buttons.current.set(id, element);
                else buttons.current.delete(id);
              }}
              type="button"
              role="tab"
              id={ids(id).tab}
              aria-selected={active}
              aria-controls={id === "files" && !filesShown ? undefined : ids(id).panel}
              aria-describedby={id === "files" && summary !== null ? filesDescriptionId : undefined}
              tabIndex={active ? 0 : -1}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-[color,background-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
                active
                  ? "bg-background text-foreground ring-1 ring-border"
                  : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
              onClick={() => select(id)}
            >
              <span data-tab-label>{label}</span>
              {id === "files" && summary !== null && (
                <span
                  aria-hidden="true"
                  className="rounded-full bg-foreground/[0.07] px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums"
                >
                  {summary.files}
                </span>
              )}
              {id === "files" && summary?.unresolvedThreads && (
                <span
                  aria-hidden="true"
                  title="Unresolved review threads"
                  className="size-1.5 rounded-full bg-attention"
                />
              )}
            </button>
          );
        })}
      </div>
      {summary !== null && (
        <span id={filesDescriptionId} className="sr-only">
          {countOf(summary.files, "changed file")}
          {summary.unresolvedThreads && ", unresolved review threads"}
        </span>
      )}
    </div>
  );
}

function SubTabPanel({
  ids,
  shown,
  children,
}: {
  ids: SubTabIds;
  shown: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={ids.panel}
      aria-labelledby={ids.tab}
      tabIndex={0}
      hidden={!shown}
      className="min-h-0 flex-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      {children}
    </div>
  );
}
