import { addTokens, type TokenTotals } from './pricing'
import type { BilledResponse } from './transcript'

export interface IndexedTranscript {
  sizeBytes: number
  modifiedAt: number | null
  /** Keyed by `${cwd}\n${utcHour}\n${model}`. */
  rows: Map<string, TokenTotals>
}

export interface SpendIndex {
  /** Keyed by transcript path relative to the Claude Code projects root. */
  transcripts: Map<string, IndexedTranscript>
}

export interface SpendIndexRow {
  cwd: string
  /** `YYYY-MM-DDTHH`, always UTC. */
  utcHour: string
  model: string
  tokens: TokenTotals
}

const SEPARATOR = '\n'

export function emptySpendIndex(): SpendIndex {
  return { transcripts: new Map() }
}

export function utcHourOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 13)
}

export function timestampOfUtcHour(utcHour: string): number {
  return Date.parse(`${utcHour}:00:00.000Z`)
}

export function rowKey(cwd: string, utcHour: string, model: string): string {
  return `${cwd}${SEPARATOR}${utcHour}${SEPARATOR}${model}`
}

export function parseRowKey(key: string): { cwd: string; utcHour: string; model: string } | null {
  const parts = key.split(SEPARATOR)
  if (parts.length !== 3) return null
  return { cwd: parts[0]!, utcHour: parts[1]!, model: parts[2]! }
}

export function indexTranscript(
  responses: Iterable<BilledResponse>,
  stat: { sizeBytes: number; modifiedAt: number | null },
): IndexedTranscript {
  const rows = new Map<string, TokenTotals>()
  for (const response of responses) {
    const key = rowKey(response.cwd, utcHourOf(response.timestamp), response.model)
    const existing = rows.get(key)
    rows.set(key, existing ? addTokens(existing, response.tokens) : response.tokens)
  }
  return { sizeBytes: stat.sizeBytes, modifiedAt: stat.modifiedAt, rows }
}

/**
 * Replaces one transcript's contribution and leaves every other entry intact.
 * Claude Code prunes its own transcripts after about a month, so an entry whose
 * file is gone is the only surviving record of that period and is never dropped.
 */
export function mergeTranscript(index: SpendIndex, path: string, transcript: IndexedTranscript): void {
  index.transcripts.set(path, transcript)
}

export function needsRescan(
  index: SpendIndex,
  path: string,
  stat: { sizeBytes: number; modifiedAt: number | null },
): boolean {
  const indexed = index.transcripts.get(path)
  if (!indexed) return true
  return indexed.sizeBytes !== stat.sizeBytes || indexed.modifiedAt !== stat.modifiedAt
}

export function* iterateRows(index: SpendIndex): Generator<SpendIndexRow> {
  for (const transcript of index.transcripts.values()) {
    for (const [key, tokens] of transcript.rows) {
      const parsed = parseRowKey(key)
      if (parsed) yield { ...parsed, tokens }
    }
  }
}
