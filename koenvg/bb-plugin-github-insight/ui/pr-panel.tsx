import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import { useCommandIntent } from "./command-intents";
import { ShowFilesProvider, type FilesJump, type FilesJumpRequest } from "./files-jump";
import { FilesTab } from "./files-tab";
import { OverviewTab } from "./overview-tab";

export function PrPanel({ threadId }: PluginThreadPanelProps) {
  return <PrPanelContent key={threadId} threadId={threadId} focus={null} />;
}

/** A comment to show when the view opens: in the conversation, or an inline comment in the diff. */
export interface PrViewFocus {
  kind: "conversation" | "inline";
  commentId: string;
}

/**
 * The PR tab for any PR, as one page read from top to bottom: title, description, conversation,
 * the diff, then the merge status. `threadId` is a thread id or a PR subject id
 * (core/pr-subject.ts).
 */
export function PrView({ threadId, focus }: { threadId: string; focus: PrViewFocus | null }) {
  return (
    <PrPanelContent
      key={`${threadId} ${focus?.kind ?? ""} ${focus?.commentId ?? ""}`}
      threadId={threadId}
      focus={focus}
    />
  );
}

function PrPanelContent({ threadId, focus }: { threadId: string; focus: PrViewFocus | null }) {
  const scroll = useRef<HTMLDivElement>(null);
  const filesSection = useRef<HTMLElement | null>(null);
  // "Show files" can come before the files are on the page; they scroll into view once they are.
  const filesWanted = useRef(false);
  const [jump, setJump] = useState<FilesJump | null>(() =>
    focus?.kind === "inline" ? { commentIds: [focus.commentId] } : null,
  );
  const scrollToFiles = useCallback(() => {
    if (filesSection.current === null) filesWanted.current = true;
    else filesSection.current.scrollIntoView({ block: "start" });
  }, []);
  const placeFilesSection = useCallback((section: HTMLElement | null) => {
    filesSection.current = section;
    if (section === null || !filesWanted.current) return;
    filesWanted.current = false;
    section.scrollIntoView({ block: "start" });
  }, []);
  const showFiles = useCallback(
    (next: FilesJump) => {
      if (next.commentIds.length === 0) scrollToFiles();
      else setJump(next);
    },
    [scrollToFiles],
  );
  const jumpRequest = useMemo<FilesJumpRequest | null>(
    () => jump && { ...jump, onHandled: () => setJump(null) },
    [jump],
  );
  useCommandIntent(threadId, "pr", (intent) => {
    if (intent === "show-files") {
      scrollToFiles();
      return;
    }
    filesWanted.current = false;
    if (scroll.current !== null) scroll.current.scrollTop = 0;
  });
  useScrollToComment(scroll, focus?.kind === "conversation" ? focus.commentId : null);
  return (
    <div
      ref={scroll}
      data-diff-scroll-area
      className="h-full min-w-0 overflow-y-auto [contain:inline-size]"
    >
      <ShowFilesProvider value={showFiles}>
        <OverviewTab
          threadId={threadId}
          scrollRoot={scroll}
          files={
            <section ref={placeFilesSection} aria-label="Files" className="border-y border-border">
              <FilesTab threadId={threadId} jump={jumpRequest} scrollRoot={scroll} />
            </section>
          }
        />
      </ShowFilesProvider>
    </div>
  );
}

const FOCUS_WAIT_MS = 15_000;
const FOCUS_RING_MS = 1_500;

/** Scrolls to a conversation comment once the timeline renders it, and rings it briefly. */
function useScrollToComment(root: RefObject<HTMLElement | null>, commentId: string | null) {
  useEffect(() => {
    const container = root.current;
    if (commentId === null || container === null) return;
    let ringTimer: ReturnType<typeof setTimeout> | undefined;
    const find = () =>
      container.querySelector<HTMLElement>(`[data-timeline-comment-id="${CSS.escape(commentId)}"]`);
    const show = (card: HTMLElement) => {
      observer.disconnect();
      clearTimeout(giveUp);
      card.scrollIntoView({ block: "center" });
      card.setAttribute("data-jumped", "");
      ringTimer = setTimeout(() => card.removeAttribute("data-jumped"), FOCUS_RING_MS);
    };
    const observer = new MutationObserver(() => {
      const card = find();
      if (card !== null) show(card);
    });
    const giveUp = setTimeout(() => observer.disconnect(), FOCUS_WAIT_MS);
    const card = find();
    if (card !== null) show(card);
    else observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
      clearTimeout(ringTimer);
    };
  }, [root, commentId]);
}
