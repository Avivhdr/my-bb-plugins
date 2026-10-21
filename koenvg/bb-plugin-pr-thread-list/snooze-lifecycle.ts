interface SnoozeAction {
  members: ReadonlySet<string>;
  readonly signalled: boolean;
}

// One queue orders plugin read/unread mutations. Event capture starts before
// queuing or loading the hierarchy, then reconciles signals with membership.
export function createSnoozeLifecycle() {
  let tail = Promise.resolve();
  const pending = new Set<{ members: Set<string>; signals: Set<string>; removed: Set<string> }>();

  function exclusive<T>(run: () => Promise<T>): Promise<T> {
    const result = tail.then(run);
    tail = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  return {
    exclusive,
    async snooze(select: () => Promise<string[]>, apply: (action: SnoozeAction) => Promise<void>) {
      const action = {
        members: new Set<string>(),
        signals: new Set<string>(),
        removed: new Set<string>(),
      };
      pending.add(action);
      try {
        await exclusive(async () => {
          for (const id of await select()) if (!action.removed.has(id)) action.members.add(id);
          await apply({
            members: action.members,
            get signalled() {
              return [...action.members].some((id) => action.signals.has(id));
            },
          });
        });
      } finally {
        pending.delete(action);
      }
    },
    signal(threadId: string) {
      for (const action of pending) action.signals.add(threadId);
    },
    remove(threadId: string) {
      for (const action of pending) {
        action.removed.add(threadId);
        action.members.delete(threadId);
      }
    },
  };
}
