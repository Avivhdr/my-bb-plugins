import { addTokens, contextTokens, EMPTY_TOKENS, type TokenTotals } from './pricing'
import { utcHourOf } from './spendIndex'
import type { BilledResponse } from './transcript'

export const CONTEXT_BANDS = ['under100k', '100kTo250k', '250kTo500k', 'over500k'] as const
export type ContextBand = (typeof CONTEXT_BANDS)[number]

export const RECACHE_GAPS = ['5to15m', '15to60m', 'over60m'] as const
export type RecacheGap = (typeof RECACHE_GAPS)[number]

export type CacheTtl = '5m' | '1h'

/** What one transcript says about its session, beyond the tokens it billed. */
export interface SessionSummary {
  /** The last `ai-title` Claude Code wrote, or null before it named the session. */
  title: string | null
  cwd: string | null
  model: string | null
  firstAt: number | null
  lastAt: number | null
  calls: number
  peakContext: number
  lastContext: number
  /** Which prompt-cache lifetime the session writes to, read from its latest cache write. */
  cacheTtl: CacheTtl
  pullRequests: string[]
}

export interface FacetTotals {
  calls: number
  tokens: TokenTotals
}

export interface SessionAnalysis {
  session: SessionSummary
  /** Keyed by `${utcHour}\n${model}\n${facet}`, see {@link facetKey}. */
  facets: Map<string, FacetTotals>
}

export type Facet = `band:${ContextBand}` | `recache:${RecacheGap}`

const MINUTE_MS = 60_000
/** The default prompt-cache lifetime. A pause longer than this leaves the next call nothing to read. */
const SHORT_TTL_MS = 5 * MINUTE_MS
/** Below this a re-cache costs cents, which is not worth flagging. */
const MIN_RECACHE_CONTEXT = 20_000
const SEPARATOR = '\n'

export function contextBandOf(context: number): ContextBand {
  if (context < 100_000) return 'under100k'
  if (context < 250_000) return '100kTo250k'
  if (context < 500_000) return '250kTo500k'
  return 'over500k'
}

function recacheGapOf(gapMs: number): RecacheGap {
  if (gapMs < 15 * MINUTE_MS) return '5to15m'
  if (gapMs < 60 * MINUTE_MS) return '15to60m'
  return 'over60m'
}

export function facetKey(utcHour: string, model: string, facet: Facet): string {
  return `${utcHour}${SEPARATOR}${model}${SEPARATOR}${facet}`
}

export function parseFacetKey(key: string): { utcHour: string; model: string; facet: Facet } | null {
  const parts = key.split(SEPARATOR)
  if (parts.length !== 3) return null
  return { utcHour: parts[0]!, model: parts[1]!, facet: parts[2] as Facet }
}

function cacheTtlOf(tokens: TokenTotals): CacheTtl | null {
  if (tokens.cacheWrite5m === 0 && tokens.cacheWrite1h === 0) return null
  return tokens.cacheWrite1h > tokens.cacheWrite5m ? '1h' : '5m'
}

/**
 * A pause re-caches when the next call writes most of its context again
 * instead of reading it. That catches both lifetimes: a session on the
 * one-hour cache simply never shows the large write after a ten-minute pause.
 */
function isRecache(context: number, tokens: TokenTotals, gapMs: number | null): boolean {
  if (gapMs === null || gapMs <= SHORT_TTL_MS || context < MIN_RECACHE_CONTEXT) return false
  return tokens.cacheWrite5m + tokens.cacheWrite1h >= context / 2
}

function add(facets: Map<string, FacetTotals>, key: string, tokens: TokenTotals): void {
  const existing = facets.get(key)
  facets.set(key, existing ? { calls: existing.calls + 1, tokens: addTokens(existing.tokens, tokens) } : { calls: 1, tokens })
}

export function analyzeSession(
  responses: Iterable<BilledResponse>,
  meta: { title?: string | null; pullRequests?: Iterable<string> } = {},
): SessionAnalysis {
  const ordered = [...responses].sort((left, right) => left.timestamp - right.timestamp)
  const facets = new Map<string, FacetTotals>()
  const session: SessionSummary = {
    title: meta.title ?? null,
    cwd: null,
    model: null,
    firstAt: null,
    lastAt: null,
    calls: 0,
    peakContext: 0,
    lastContext: 0,
    cacheTtl: '5m',
    pullRequests: [...new Set(meta.pullRequests ?? [])],
  }
  let previousAt: number | null = null
  for (const response of ordered) {
    const context = contextTokens(response.tokens)
    const hour = utcHourOf(response.timestamp)
    add(facets, facetKey(hour, response.model, `band:${contextBandOf(context)}`), response.tokens)
    const gapMs = previousAt === null ? null : response.timestamp - previousAt
    if (isRecache(context, response.tokens, gapMs)) {
      const written = { ...EMPTY_TOKENS, cacheWrite5m: response.tokens.cacheWrite5m, cacheWrite1h: response.tokens.cacheWrite1h }
      add(facets, facetKey(hour, response.model, `recache:${recacheGapOf(gapMs!)}`), written)
    }
    session.cwd = response.cwd
    session.model = response.model
    session.firstAt ??= response.timestamp
    session.lastAt = response.timestamp
    session.calls += 1
    session.peakContext = Math.max(session.peakContext, context)
    session.lastContext = context
    session.cacheTtl = cacheTtlOf(response.tokens) ?? session.cacheTtl
    previousAt = response.timestamp
  }
  return { session, facets }
}
