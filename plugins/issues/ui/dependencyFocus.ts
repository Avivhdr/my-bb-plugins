import { createContext, useContext } from "react";

/**
 * The board's dependency highlight. Hovering or focusing an issue marks it and every
 * issue it is linked to on the board, and brightens the arrows between them.
 */
export interface DependencyFocus {
  /** Whether `issueNumber` is the hovered issue or one linked to it. */
  isHighlighted: (issueNumber: number) => boolean;
  /** Scroll a board issue into view and highlight it. False when it is not on the board. */
  reveal: (issueNumber: number) => boolean;
}

const NO_FOCUS: DependencyFocus = {
  isHighlighted: () => false,
  reveal: () => false,
};

export const DependencyFocusContext = createContext<DependencyFocus>(NO_FOCUS);

export function useDependencyFocus(): DependencyFocus {
  return useContext(DependencyFocusContext);
}

/** The ring a highlighted card or sub-issue row gets. */
export const HIGHLIGHT_CLASS = "ring-2 ring-warning/70";
