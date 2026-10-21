import { useEffect, useRef } from "react";

export interface IntentsByTab {
  pr: "show-overview" | "show-files";
  overview: "refresh" | "open-on-github";
  files: "submit" | "next-comment" | "previous-comment";
  merge: "merge";
}

export type CommandTab = keyof IntentsByTab;
export type IntentOf<Tab extends CommandTab> = IntentsByTab[Tab];

type Listener = (intent: string) => void;

const PENDING_TTL_MS = 10_000;

const pending = new Map<string, { intent: string; postedAt: number }>();
const listeners = new Map<string, Listener[]>();

function keyOf(threadId: string, tab: CommandTab): string {
  return `${tab}:${threadId}`;
}

export function postIntent<Tab extends CommandTab>(
  threadId: string,
  tab: Tab,
  intent: IntentOf<Tab>,
): void {
  const key = keyOf(threadId, tab);
  const listener = listeners.get(key)?.at(-1);
  if (listener) listener(intent);
  else pending.set(key, { intent, postedAt: Date.now() });
}

export function peekIntent<Tab extends CommandTab>(
  threadId: string,
  tab: Tab,
): IntentOf<Tab> | null {
  const entry = pending.get(keyOf(threadId, tab));
  if (!entry || Date.now() - entry.postedAt > PENDING_TTL_MS) return null;
  return entry.intent as IntentOf<Tab>;
}

function takePending(key: string): string | null {
  const entry = pending.get(key);
  pending.delete(key);
  if (!entry || Date.now() - entry.postedAt > PENDING_TTL_MS) return null;
  return entry.intent;
}

export function useCommandIntent<Tab extends CommandTab>(
  threadId: string,
  tab: Tab,
  onIntent: (intent: IntentOf<Tab>) => void,
): void {
  const latest = useRef(onIntent);
  useEffect(() => {
    latest.current = onIntent;
  });

  useEffect(() => {
    const key = keyOf(threadId, tab);
    const listener: Listener = (intent) => latest.current(intent as IntentOf<Tab>);
    const stack = listeners.get(key) ?? [];
    listeners.set(key, [...stack, listener]);
    const waiting = takePending(key);
    if (waiting !== null) listener(waiting);
    return () => {
      const remaining = (listeners.get(key) ?? []).filter((entry) => entry !== listener);
      if (remaining.length > 0) listeners.set(key, remaining);
      else listeners.delete(key);
    };
  }, [threadId, tab]);
}
