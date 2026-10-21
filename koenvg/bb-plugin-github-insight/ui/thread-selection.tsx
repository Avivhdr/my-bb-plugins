import { createContext, useContext, useMemo, useState } from "react";

export interface ThreadSelection {
  isSelected(reviewThreadId: string): boolean;
  toggle(reviewThreadId: string): void;
}

export const ThreadSelectionContext = createContext<ThreadSelection | null>(null);

export function useThreadSelection(): ThreadSelection {
  const selection = useContext(ThreadSelectionContext);
  if (selection === null) throw new Error("ReviewThreadCard needs a ThreadSelectionContext");
  return selection;
}

export function useThreadSelectionState(selectableIds: readonly string[]) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const selectedIds = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected],
  );
  const selection = useMemo<ThreadSelection>(
    () => ({
      isSelected: (id) => selected.has(id),
      toggle: (id) =>
        setSelected((current) => {
          const next = new Set(current);
          if (!next.delete(id)) next.add(id);
          return next;
        }),
    }),
    [selected],
  );
  const deselect = (ids: readonly string[]) =>
    setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))));
  return { selection, selectedIds, deselect };
}
