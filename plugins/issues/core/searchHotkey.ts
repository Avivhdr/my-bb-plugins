// DOM-facing predicates for the board's search hotkeys (`/` to focus, Esc to clear).
// Kept out of lib/search.ts so that module stays pure text logic with no DOM dependency.

/**
 * Elements that already consume typed characters — `/` must not steal focus from
 * these. Checked via the `contenteditable` attribute rather than the
 * `isContentEditable` DOM property: jsdom doesn't implement that property's
 * inheritance computation, and the attribute is what the board itself ever sets.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null
}

/** Is this the plain, unmodified `/` keypress that should focus search? */
export function isSearchFocusKey(event: KeyboardEvent): boolean {
  if (event.key !== '/') return false
  return !event.metaKey && !event.ctrlKey && !event.altKey
}
