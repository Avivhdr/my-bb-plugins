import type { ActionResult, PrAction, RunPrActionRequest } from "../contract";
import { messageOf } from "./error-message";

type Request = Omit<RunPrActionRequest, "threadId">;
export type PrOperationState =
  | { kind: "idle" }
  | ({ kind: "running" } & Request)
  | { kind: "error"; message: string; headOid: string; action: PrAction };

const IDLE: PrOperationState = { kind: "idle" };

export const PR_ACTION_BUSY_LABEL: Record<PrAction, string> = {
  merge: "Merging…",
  enqueue: "Enqueuing…",
  "update-merge": "Updating…",
  "update-rebase": "Updating…",
  "enable-auto-merge": "Enabling…",
  "disable-auto-merge": "Disabling…",
};

export function createPrOperations() {
  const states = new Map<string, PrOperationState>();
  const listeners = new Map<string, Set<() => void>>();
  const snapshot = (threadId: string): PrOperationState => states.get(threadId) ?? IDLE;
  const prune = (threadId: string) => {
    // No listener entry means React has not subscribed yet. Keep a fast error
    // for that first subscription. An empty entry means the last viewer left.
    if (listeners.get(threadId)?.size === 0 && snapshot(threadId).kind !== "running") {
      states.delete(threadId);
      listeners.delete(threadId);
    }
  };
  function publish(threadId: string, state: PrOperationState) {
    if (state.kind === "idle") states.delete(threadId);
    else states.set(threadId, state);
    listeners.get(threadId)?.forEach((notify) => notify());
    prune(threadId);
  }
  function subscribe(threadId: string, notify: () => void) {
    const entries = listeners.get(threadId) ?? new Set();
    entries.add(notify);
    listeners.set(threadId, entries);
    return () => {
      entries.delete(notify);
      prune(threadId);
    };
  }
  async function run(
    threadId: string,
    request: Request,
    send: () => Promise<ActionResult>,
  ): Promise<ActionResult | null> {
    if (snapshot(threadId).kind === "running") return null;
    publish(threadId, { kind: "running", ...request });
    let result: ActionResult;
    try {
      result = await send();
    } catch (error) {
      result = { kind: "error", message: messageOf(error) };
    }
    publish(
      threadId,
      result.kind === "error"
        ? { ...result, headOid: request.expectedHeadOid, action: request.action }
        : IDLE,
    );
    return result;
  }
  function dismiss(threadId: string) {
    if (snapshot(threadId).kind === "error") publish(threadId, IDLE);
  }
  return { snapshot, subscribe, run, dismiss };
}

export const prOperations = createPrOperations();
