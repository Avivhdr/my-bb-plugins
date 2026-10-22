import type { Prompt, Prompts } from "./server";

export interface PromptIndex {
  positions: ReadonlyMap<string, number>;
  prompts: readonly Prompt[];
  promptRows: ReadonlySet<string>;
  /** Turn id -> position in `prompts`. */
  turns: ReadonlyMap<string, number>;
}

/** A rendered timeline row's vertical extent, in viewport pixels. */
export interface RowBox {
  id: string;
  top: number;
  bottom: number;
}

export interface Pin {
  rowId: string;
  text: string;
  /** Position in the server's row list, or null when the text came from the page. */
  index: number | null;
}

export function indexPrompts({ rowIds, prompts }: Prompts): PromptIndex {
  const turns = new Map<string, number>();
  prompts.forEach((prompt, ordinal) => {
    for (const turnId of prompt.turnIds) turns.set(turnId, ordinal);
  });
  return {
    positions: new Map(rowIds.map((id, position) => [id, position])),
    prompts,
    promptRows: new Set(prompts.map((prompt) => prompt.rowId)),
    turns,
  };
}

/** "thr_abc:user-seed:12" -> "thr_abc". */
export function threadIdOf(rowId: string): string | null {
  return /^(thr_[a-z0-9]+):/.exec(rowId)?.[1] ?? null;
}

export function isPromptRowId(rowId: string): boolean {
  return /:user(-seed)?:/.test(rowId);
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Turn ids look like "da4fbe7dce-t2" and appear inside page row ids. */
const TURN_ID = /(?<![0-9a-z])[0-9a-z]+-t\d+(?!\d)/g;

/**
 * Which prompt a row belongs to, as a position in `index.prompts`. -1 for a
 * row before the first prompt, undefined for a row the index doesn't know.
 */
export function promptOf(index: PromptIndex, rowId: string): number | undefined {
  const position = index.positions.get(rowId);
  if (position !== undefined) {
    let ordinal = -1;
    while (ordinal + 1 < index.prompts.length && index.prompts[ordinal + 1]!.index <= position) ordinal++;
    return ordinal;
  }
  for (const [turnId] of rowId.matchAll(TURN_ID)) {
    const ordinal = index.turns.get(turnId);
    if (ordinal !== undefined) return ordinal;
  }
  return undefined;
}

/** The prompt for the row at `at`, judged from the nearest row the index knows. */
function resolve(index: PromptIndex, rows: readonly RowBox[], at: number): number | undefined {
  for (let i = at; i >= 0; i--) {
    const ordinal = promptOf(index, rows[i]!.id);
    if (ordinal !== undefined) return ordinal;
  }
  for (let i = at + 1; i < rows.length; i++) {
    const ordinal = promptOf(index, rows[i]!.id);
    if (ordinal === undefined) continue;
    // A prompt row below the anchor starts a later turn than the anchor's.
    return index.prompts[ordinal]?.rowId === rows[i]!.id ? ordinal - 1 : ordinal;
  }
  return undefined;
}

/** Whether a row is one of the user's messages. Rows the index doesn't know are judged by id. */
function isPrompt(index: PromptIndex | null, rowId: string): boolean {
  if (index?.positions.has(rowId)) return index.promptRows.has(rowId);
  return isPromptRowId(rowId);
}

/**
 * What to pin above a chat whose visible area runs from `edge` to `bottom`.
 * `rows` are the rendered rows sorted by `top`. `stale` asks the caller to
 * refetch the index.
 */
export function pinFor(
  index: PromptIndex | null,
  rows: readonly RowBox[],
  edge: number,
  bottom: number,
  textOf: (rowId: string) => string | null,
): { pin: Pin | null; stale: boolean } {
  const at = rows.findIndex((row) => row.bottom > edge);
  if (at < 0) return { pin: null, stale: false };

  let pin: Pin | null = null;
  const ordinal = index ? resolve(index, rows, at) : undefined;
  const prompt = ordinal === undefined ? undefined : index!.prompts[ordinal];
  if (prompt) pin = { rowId: prompt.rowId, text: prompt.text, index: prompt.index };
  else if (ordinal === undefined) {
    // Fall back to the nearest prompt the page has rendered above the anchor.
    for (let i = at; i >= 0 && !pin; i--) {
      const row = rows[i]!;
      const text = isPromptRowId(row.id) ? textOf(row.id) : null;
      if (text) pin = { rowId: row.id, text, index: null };
    }
  }

  // With any prompt in view the bar could only point at an older one, which
  // hides the newest. The bar shows again once every prompt is off screen.
  if (rows.some((row) => row.bottom > edge && row.top < bottom && isPrompt(index, row.id))) pin = null;
  return { pin, stale: ordinal === undefined };
}
