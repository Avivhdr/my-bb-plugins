import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../contract";
import type { ReviewThread } from "../core/review-threads";
import { useCommentSeen } from "./use-comment-seen";

const SAVE_DELAY_MS = 300;

interface NewCommentGlow {
  root: RefObject<HTMLElement | null>;
  glowingIds: ReadonlySet<string>;
  watches(commentId: string): boolean;
  markSeen(commentId: string): void;
}

const NO_GLOW: NewCommentGlow = {
  root: { current: null },
  glowingIds: new Set(),
  watches: () => false,
  markSeen: () => {},
};

export const NewCommentGlowContext = createContext<NewCommentGlow>(NO_GLOW);

export function useThreadHasNewComment(thread: ReviewThread): boolean {
  const { glowingIds } = useContext(NewCommentGlowContext);
  return thread.comments.some((comment) => glowingIds.has(comment.id));
}

export function useNewComment(commentId: string) {
  const { root, glowingIds, watches, markSeen } = useContext(NewCommentGlowContext);
  const ref = useRef<HTMLDivElement>(null);
  const onSeen = useCallback(() => markSeen(commentId), [markSeen, commentId]);
  useCommentSeen(ref, root, watches(commentId), onSeen);
  return { ref, glowing: glowingIds.has(commentId) };
}

export function useNewCommentGlowState(
  threadId: string,
  newCommentIds: readonly string[],
  root: RefObject<HTMLElement | null>,
): NewCommentGlow {
  const rpc = useRpc<typeof rpcContract>();
  const [glowing, setGlowing] = useState<{
    from: readonly string[];
    ids: ReadonlySet<string>;
  }>(() => ({ from: newCommentIds, ids: new Set(newCommentIds) }));
  if (glowing.from !== newCommentIds) {
    setGlowing({ from: newCommentIds, ids: new Set([...glowing.ids, ...newCommentIds]) });
  }
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(new Set<string>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback(() => {
    saveTimer.current = undefined;
    const commentIds = [...pending.current];
    pending.current.clear();
    if (commentIds.length === 0) return;
    rpc.call("markCommentsSeen", { threadId, commentIds }).catch(() => {});
  }, [rpc, threadId]);

  useEffect(
    () => () => {
      clearTimeout(saveTimer.current);
      save();
    },
    [save],
  );

  const markSeen = useCallback(
    (commentId: string) => {
      setSeen((current) => new Set(current).add(commentId));
      pending.current.add(commentId);
      saveTimer.current ??= setTimeout(save, SAVE_DELAY_MS);
    },
    [save],
  );

  return useMemo(
    () => ({
      root,
      glowingIds: glowing.ids,
      watches: (id) => glowing.ids.has(id) && !seen.has(id),
      markSeen,
    }),
    [root, glowing.ids, seen, markSeen],
  );
}
