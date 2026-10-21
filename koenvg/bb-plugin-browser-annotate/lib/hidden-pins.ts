export function createHiddenPins() {
  const hidden = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    hide(id: string) {
      if (hidden.has(id)) return;
      hidden.add(id);
      notify();
    },
    show(id: string) {
      if (hidden.delete(id)) notify();
    },
    has(id: string) {
      return hidden.has(id);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type HiddenPins = ReturnType<typeof createHiddenPins>;
