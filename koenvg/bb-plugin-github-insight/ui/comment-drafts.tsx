import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import { draftLineText } from "../core/comment-draft-view";
import type { DiffSide } from "../core/diff-lines";
import type { ListedCommentDraft } from "../core/review-drafts";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { JUMPED_RING, QUIET_BUTTON, TEXTAREA } from "./controls";
import { useDraftSaves } from "./draft-saves";
import { useJumpHighlight } from "./jump-highlight";
import { messageOf } from "./error-message";

interface LocalState {
  typedText: string | null;
  busy: boolean;
  error: string | null;
}

const IDLE: LocalState = { typedText: null, busy: false, error: null };

interface CommentDraftState {
  text: string;
  busy: boolean;
  error: string | null;
}

interface CommentDrafts {
  stateOf(draft: ListedCommentDraft): CommentDraftState;
  setText(draftId: string, text: string): void;
  remove(draftId: string): Promise<void>;
  flushAll(): Promise<void>;
}

interface NewComments {
  create(path: string, side: DiffSide, line: number): Promise<void>;
  createError: string | null;
  focusDraftId: string | null;
  clearFocus(): void;
}

const CommentDraftsContext = createContext<CommentDrafts | null>(null);
const NewCommentsContext = createContext<NewComments | null>(null);

export function CommentDraftsProvider({
  threadId,
  onDeleteStarted,
  onDeleteFailed,
  children,
}: {
  threadId: string;
  onDeleteStarted: (draftId: string) => void;
  onDeleteFailed: () => void;
  children: ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [states, setStates] = useState<Record<string, LocalState>>({});

  const update = useCallback((draftId: string, patch: Partial<LocalState>) => {
    setStates((current) => ({
      ...current,
      [draftId]: { ...(current[draftId] ?? IDLE), ...patch },
    }));
  }, []);

  const saveCommentDraft = useCallback(
    (draftId: string, body: string) => rpc.call("saveCommentDraft", { threadId, draftId, body }),
    [rpc, threadId],
  );
  const reportSaveError = useCallback(
    (draftId: string, error: string) => update(draftId, { error }),
    [update],
  );
  const draftSaves = useDraftSaves(saveCommentDraft, reportSaveError);

  const stateOf = useCallback(
    (draft: ListedCommentDraft): CommentDraftState => {
      const { typedText, busy, error } = states[draft.id] ?? IDLE;
      return { text: typedText ?? draft.body, busy, error };
    },
    [states],
  );

  const setText = useCallback(
    (draftId: string, text: string) => {
      update(draftId, { typedText: text });
      draftSaves.schedule(draftId, text);
    },
    [update, draftSaves],
  );

  const remove = useCallback(
    async (draftId: string) => {
      onDeleteStarted(draftId);
      update(draftId, { busy: true, error: null });
      await draftSaves.flush(draftId);
      const result = await rpc
        .call("deleteCommentDraft", { threadId, draftId })
        .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
      if (result.kind === "error") {
        update(draftId, { busy: false, error: result.message });
        onDeleteFailed();
        return;
      }
      update(draftId, { busy: false });
    },
    [rpc, threadId, update, draftSaves, onDeleteStarted, onDeleteFailed],
  );

  const [createError, setCreateError] = useState<string | null>(null);
  const [focusDraftId, setFocusDraftId] = useState<string | null>(null);

  const create = useCallback(
    async (path: string, side: DiffSide, line: number) => {
      setCreateError(null);
      const result = await rpc
        .call("createCommentDraft", { threadId, path, side, line })
        .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
      if (result.kind === "error") {
        setCreateError(result.message);
        return;
      }
      setFocusDraftId(result.draftId);
    },
    [rpc, threadId],
  );

  const clearFocus = useCallback(() => setFocusDraftId(null), []);

  const value = useMemo<CommentDrafts>(
    () => ({ stateOf, setText, remove, flushAll: draftSaves.flushAll }),
    [stateOf, setText, remove, draftSaves],
  );
  const newComments = useMemo<NewComments>(
    () => ({ create, createError, focusDraftId, clearFocus }),
    [create, createError, focusDraftId, clearFocus],
  );

  return (
    <NewCommentsContext.Provider value={newComments}>
      <CommentDraftsContext.Provider value={value}>{children}</CommentDraftsContext.Provider>
    </NewCommentsContext.Provider>
  );
}

export function useCommentDrafts(): CommentDrafts {
  const drafts = useContext(CommentDraftsContext);
  if (drafts === null) throw new Error("useCommentDrafts needs a CommentDraftsProvider");
  return drafts;
}

export function useNewComments(): NewComments {
  const newComments = useContext(NewCommentsContext);
  if (newComments === null) throw new Error("useNewComments needs a CommentDraftsProvider");
  return newComments;
}

export function CommentDraftCard({
  draft,
  showLocation = false,
}: {
  draft: ListedCommentDraft;
  showLocation?: boolean;
}) {
  const drafts = useCommentDrafts();
  const headingId = useId();
  const { text, busy, error } = drafts.stateOf(draft);
  const box = useRef<HTMLTextAreaElement>(null);
  const { focusDraftId, clearFocus } = useNewComments();
  useEffect(() => {
    if (focusDraftId !== draft.id) return;
    box.current?.focus();
    clearFocus();
  }, [focusDraftId, clearFocus, draft.id]);
  const jumped = useJumpHighlight("draft", draft.id);
  return (
    <section
      aria-labelledby={headingId}
      data-comment-draft-id={draft.id}
      data-jumped={jumped || undefined}
      className={cn(
        "mx-2 my-2 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2.5 font-sans text-sm transition-shadow duration-200 motion-reduce:transition-none",
        JUMPED_RING,
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <h3 id={headingId} className="flex shrink-0 items-center gap-1.5 font-medium text-primary">
          <Icon name="MessageSquare" className="size-3.5" />
          Pending comment
        </h3>
        {showLocation && (
          <span className="min-w-0 truncate font-mono" title={draft.path}>
            {draft.path}
          </span>
        )}
        <Pill>{draftLineText(draft)}</Pill>
        {showLocation && <Pill>{draft.side === "RIGHT" ? "New side" : "Old side"}</Pill>}
      </div>
      <textarea
        ref={box}
        aria-label="Comment"
        rows={2}
        className={cn(TEXTAREA, "border-primary/30")}
        value={text}
        disabled={busy}
        onChange={(event) => drafts.setText(draft.id, event.target.value)}
      />
      {error !== null && (
        <p role="alert" className="flex items-start gap-1.5 break-words text-xs text-destructive">
          <Icon name="AlertCircle" className="mt-px size-3.5 shrink-0" />
          {error}
        </p>
      )}
      <div className="flex items-center">
        <button
          type="button"
          className={QUIET_BUTTON}
          disabled={busy}
          onClick={() => void drafts.remove(draft.id)}
        >
          <Icon name="Trash2" className="size-3.5" />
          Delete
        </button>
      </div>
    </section>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-muted px-2 text-muted-foreground tabular-nums">
      {children}
    </span>
  );
}
