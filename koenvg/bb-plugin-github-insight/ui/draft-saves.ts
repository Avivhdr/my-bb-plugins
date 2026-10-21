import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ActionResult } from "../contract";
import { messageOf } from "./error-message";

const DRAFT_SAVE_DELAY_MS = 500;

export type SaveDraft = (key: string, body: string) => Promise<ActionResult>;

export function useDraftSaves(save: SaveDraft, onError: (key: string, message: string) => void) {
  const unsaved = useRef(new Map<string, { body: string; timer: ReturnType<typeof setTimeout> }>());
  const saving = useRef(new Map<string, Promise<void>>());

  const flush = useCallback(
    (key: string): Promise<void> => {
      const previous = saving.current.get(key) ?? Promise.resolve();
      const pending = unsaved.current.get(key);
      if (pending === undefined) return previous;
      clearTimeout(pending.timer);
      unsaved.current.delete(key);
      const saved = previous.then(async () => {
        const result = await save(key, pending.body).catch((error: unknown) => ({
          kind: "error" as const,
          message: messageOf(error),
        }));
        if (result.kind === "error") onError(key, result.message);
      });
      saving.current.set(key, saved);
      return saved;
    },
    [save, onError],
  );

  const schedule = useCallback(
    (key: string, body: string) => {
      clearTimeout(unsaved.current.get(key)?.timer);
      const timer = setTimeout(() => void flush(key), DRAFT_SAVE_DELAY_MS);
      unsaved.current.set(key, { body, timer });
    },
    [flush],
  );

  const flushAll = useCallback(async () => {
    const keys = new Set([...unsaved.current.keys(), ...saving.current.keys()]);
    await Promise.all([...keys].map(flush));
  }, [flush]);

  useEffect(() => {
    const pending = unsaved.current;
    return () => {
      for (const key of [...pending.keys()]) void flush(key);
    };
  }, [flush]);

  return useMemo(() => ({ flush, flushAll, schedule }), [flush, flushAll, schedule]);
}
