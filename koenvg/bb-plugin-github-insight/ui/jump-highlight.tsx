import { createContext, useContext, useEffect, useState } from "react";
import type { CommentStop } from "../core/comment-stops";

const HIGHLIGHT_MS = 1500;

export interface JumpMark {
  stop: CommentStop;
  token: number;
}

export const JumpMarkContext = createContext<JumpMark | null>(null);

export function useJumpHighlight(kind: CommentStop["kind"], id: string): boolean {
  const mark = useContext(JumpMarkContext);
  const token = mark !== null && mark.stop.kind === kind && mark.stop.id === id ? mark.token : null;
  const [fadedToken, setFadedToken] = useState<number | null>(null);
  useEffect(() => {
    if (token === null) return;
    const timer = setTimeout(() => setFadedToken(token), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [token]);
  return token !== null && token !== fadedToken;
}
