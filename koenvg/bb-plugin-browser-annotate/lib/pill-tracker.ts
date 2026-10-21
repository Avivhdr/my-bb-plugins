export const PILL_REMOVAL_DELAY_MS = 3000;

export interface PillTrackerDeps {
  remove(threadId: string, id: string): Promise<unknown>;
  clearResolved(threadId: string): Promise<{ removed: string[] }>;
  hide(id: string): void;
  show(id: string): void;
  delayMs?: number;
}

// A submit empties the draft before onSubmitted fires, so a missing pill only
// counts as removed by the user after a delay that a submit can cancel.
export function createPillTracker(deps: PillTrackerDeps) {
  const delayMs = deps.delayMs ?? PILL_REMOVAL_DELAY_MS;
  const seen = new Map<string, Set<string>>();
  const pending = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

  const pendingFor = (threadId: string) => {
    let timers = pending.get(threadId);
    if (!timers) pending.set(threadId, (timers = new Map()));
    return timers;
  };

  return {
    observe(threadId: string, ids: readonly string[]) {
      const present = new Set(ids);
      const known = seen.get(threadId) ?? new Set<string>();
      const timers = pendingFor(threadId);
      for (const id of present) {
        const timer = timers.get(id);
        if (timer !== undefined) {
          clearTimeout(timer);
          timers.delete(id);
          deps.show(id);
        }
        known.add(id);
      }
      for (const id of known) {
        if (present.has(id) || timers.has(id)) continue;
        deps.hide(id);
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id);
            known.delete(id);
            void deps.remove(threadId, id).catch(() => deps.show(id));
          }, delayMs),
        );
      }
      seen.set(threadId, known);
    },
    submitted(threadId: string) {
      const timers = pendingFor(threadId);
      const known = seen.get(threadId);
      const cancelled = [...timers.keys()];
      for (const [id, timer] of timers) {
        clearTimeout(timer);
        known?.delete(id);
      }
      timers.clear();
      void deps.clearResolved(threadId).then(
        ({ removed }) => cancelled.filter((id) => !removed.includes(id)).forEach(deps.show),
        () => cancelled.forEach(deps.show),
      );
    },
    dispose() {
      for (const timers of pending.values())
        for (const timer of timers.values()) clearTimeout(timer);
      pending.clear();
      seen.clear();
    },
  };
}
