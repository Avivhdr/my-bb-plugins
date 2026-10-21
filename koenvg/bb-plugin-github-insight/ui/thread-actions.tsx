import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { Draft, Drafts } from "../core/drafts";
import { useDraftSaves } from "./draft-saves";
import { messageOf } from "./error-message";
import { announceSummaryWritten } from "./summary-written";

export interface ThreadActionState {
  replyText: string;
  hasDraft: boolean;
  busy: boolean;
  error: string | null;
  pendingReviewUrl: string | null;
}

interface LocalState {
  typedText: string | null;
  dismissedDraftAt: number | null;
  busy: boolean;
  error: string | null;
  pendingReviewUrl: string | null;
}

const IDLE: LocalState = {
  typedText: null,
  dismissedDraftAt: null,
  busy: false,
  error: null,
  pendingReviewUrl: null,
};

interface ThreadActions {
  stateOf(reviewThreadId: string): ThreadActionState;
  setReplyText(reviewThreadId: string, text: string): void;
  post(reviewThreadId: string, options: { resolve: boolean }): Promise<void>;
  setResolved(reviewThreadId: string, resolved: boolean): Promise<void>;
  discardDraft(reviewThreadId: string): Promise<void>;
}

const ThreadActionsContext = createContext<ThreadActions | null>(null);

export function ThreadActionsProvider({
  threadId,
  drafts,
  onWritten,
  children,
}: {
  threadId: string;
  drafts: Drafts;
  onWritten: () => void;
  children: ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const [states, setStates] = useState<Record<string, LocalState>>({});
  const busyIds = useRef(new Set<string>());

  const update = useCallback((reviewThreadId: string, patch: Partial<LocalState>) => {
    setStates((current) => ({
      ...current,
      [reviewThreadId]: { ...(current[reviewThreadId] ?? IDLE), ...patch },
    }));
  }, []);

  const draftOf = useCallback(
    (reviewThreadId: string): Draft | undefined => {
      const stored = drafts[reviewThreadId];
      return stored?.updatedAt === states[reviewThreadId]?.dismissedDraftAt ? undefined : stored;
    },
    [states, drafts],
  );

  const stateOf = useCallback(
    (reviewThreadId: string): ThreadActionState => {
      const { typedText, busy, error, pendingReviewUrl } = states[reviewThreadId] ?? IDLE;
      const draft = draftOf(reviewThreadId);
      return {
        replyText: typedText ?? draft?.body ?? "",
        hasDraft: draft !== undefined,
        busy,
        error,
        pendingReviewUrl,
      };
    },
    [states, draftOf],
  );

  const reportSaveError = useCallback(
    (reviewThreadId: string, error: string) => update(reviewThreadId, { error }),
    [update],
  );
  const saveDraft = useCallback(
    (reviewThreadId: string, body: string) =>
      rpc.call("saveDraft", { threadId, reviewThreadId, body }),
    [rpc, threadId],
  );
  const draftSaves = useDraftSaves(saveDraft, reportSaveError);

  const runExclusive = useCallback(
    async (reviewThreadId: string, run: () => Promise<Partial<LocalState>>) => {
      if (busyIds.current.has(reviewThreadId)) return;
      busyIds.current.add(reviewThreadId);
      update(reviewThreadId, { busy: true, error: null });
      try {
        update(reviewThreadId, { ...(await run()), busy: false });
      } finally {
        busyIds.current.delete(reviewThreadId);
      }
    },
    [update],
  );

  const post = useCallback(
    (reviewThreadId: string, { resolve }: { resolve: boolean }) => {
      const { replyText: body } = stateOf(reviewThreadId);
      const draft = draftOf(reviewThreadId);
      return runExclusive(reviewThreadId, async () => {
        await draftSaves.flush(reviewThreadId);
        const result = await rpc
          .call("reply", { threadId, reviewThreadId, body, resolve })
          .catch((error: unknown) => ({ kind: "post_failed" as const, message: messageOf(error) }));
        if (result.kind === "post_failed") return { error: result.message, pendingReviewUrl: null };
        onWritten();
        if (resolve && result.resolveError === null) announceSummaryWritten(threadId);
        return {
          typedText: null,
          dismissedDraftAt: draft?.updatedAt ?? null,
          error: result.resolveError,
          pendingReviewUrl: result.pendingReviewUrl,
        };
      });
    },
    [rpc, threadId, stateOf, draftOf, runExclusive, draftSaves, onWritten],
  );

  const setResolved = useCallback(
    (reviewThreadId: string, resolved: boolean) =>
      runExclusive(reviewThreadId, async () => {
        await draftSaves.flush(reviewThreadId);
        const result = await rpc
          .call("setResolved", { threadId, reviewThreadId, resolved })
          .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
        if (result.kind === "error") return { error: result.message };
        onWritten();
        announceSummaryWritten(threadId);
        return { error: null };
      }),
    [rpc, threadId, runExclusive, draftSaves, onWritten],
  );

  const discardDraft = useCallback(
    (reviewThreadId: string) => {
      const draft = draftOf(reviewThreadId);
      return runExclusive(reviewThreadId, async () => {
        await draftSaves.flush(reviewThreadId);
        const result = await rpc
          .call("discardDraft", { threadId, reviewThreadId })
          .catch((error: unknown) => ({ kind: "error" as const, message: messageOf(error) }));
        if (result.kind === "error") return { error: result.message };
        return {
          typedText: null,
          dismissedDraftAt: draft?.updatedAt ?? null,
          error: null,
          pendingReviewUrl: null,
        };
      });
    },
    [rpc, threadId, draftOf, runExclusive, draftSaves],
  );

  const setReplyText = useCallback(
    (reviewThreadId: string, text: string) => {
      update(reviewThreadId, { typedText: text });
      if (draftOf(reviewThreadId) !== undefined) draftSaves.schedule(reviewThreadId, text);
    },
    [update, draftOf, draftSaves],
  );

  const actions = useMemo<ThreadActions>(
    () => ({ stateOf, setReplyText, post, setResolved, discardDraft }),
    [stateOf, setReplyText, post, setResolved, discardDraft],
  );

  return <ThreadActionsContext.Provider value={actions}>{children}</ThreadActionsContext.Provider>;
}

export function useThreadActions(): ThreadActions {
  const actions = useContext(ThreadActionsContext);
  if (actions === null) throw new Error("useThreadActions needs a ThreadActionsProvider");
  return actions;
}
