export function createKeyedQueue() {
  const queues = new Map<string, Promise<unknown>>();

  return function inOrder<T>(key: string, task: () => Promise<T>): Promise<T> {
    const run = (queues.get(key) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => undefined);
    queues.set(key, settled);
    void settled.then(() => {
      if (queues.get(key) === settled) queues.delete(key);
    });
    return run;
  };
}
