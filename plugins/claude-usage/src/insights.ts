import { attribute, type AttributionMap } from './attribution'
import { costOf, totalCost, type TokenTotals } from './pricing'
import { CONTEXT_BANDS, parseFacetKey, RECACHE_GAPS, type ContextBand, type RecacheGap } from './sessionAnalysis'
import { parseRowKey, timestampOfUtcHour, type SpendIndex } from './spendIndex'

/** Where the window's money went, with re-caching after a pause split out of the cache writes. */
export interface SpendSplit {
  total: number
  recache: number
  recacheByGap: Record<RecacheGap, number>
  otherCacheWrite: number
  cacheRead: number
  output: number
  input: number
}

export interface ContextBandSpend {
  band: ContextBand
  total: number
  calls: number
}

export interface SessionSpend {
  key: string
  title: string
  threadTitle: string | null
  projectName: string | null
  total: number
  calls: number
  peakContext: number
  recache: number
  lastAt: number | null
  pullRequests: string[]
}

export interface Insights {
  split: SpendSplit
  byContextBand: ContextBandSpend[]
  topSessions: SessionSpend[]
}

const TOP_SESSIONS = 15

/** A subagent's transcript sits in a folder named after its parent session. */
export function parentTranscriptOf(path: string): string {
  const marker = path.indexOf('/subagents/')
  return marker === -1 ? path : `${path.slice(0, marker)}.jsonl`
}

function spendOf(model: string, tokens: TokenTotals): number {
  const cost = costOf(model, tokens)
  return cost ? totalCost(cost) : 0
}

function emptySplit(): SpendSplit {
  return {
    total: 0,
    recache: 0,
    recacheByGap: { '5to15m': 0, '15to60m': 0, over60m: 0 },
    otherCacheWrite: 0,
    cacheRead: 0,
    output: 0,
    input: 0,
  }
}

/** Covers spend from `windowStart` on, the same window as the dashboard's 30-day figure. */
export function buildInsights(index: SpendIndex, attributionMap: AttributionMap, windowStart: number): Insights {
  const split = emptySplit()
  let cacheWrite = 0
  const bands = new Map<ContextBand, ContextBandSpend>(
    CONTEXT_BANDS.map((band) => [band, { band, total: 0, calls: 0 }]),
  )
  const sessions = new Map<string, SessionSpend>()
  const inWindow = (utcHour: string) => timestampOfUtcHour(utcHour) >= windowStart

  const sessionFor = (path: string): SessionSpend => {
    const key = parentTranscriptOf(path)
    const existing = sessions.get(key)
    if (existing) return existing
    const summary = index.transcripts.get(key)?.session ?? null
    const { project, thread } = summary?.cwd
      ? attribute(attributionMap, summary.cwd)
      : { project: { kind: 'outside' as const }, thread: null }
    const created: SessionSpend = {
      key,
      title: summary?.title ?? thread?.threadTitle ?? 'Untitled session',
      threadTitle: thread?.threadTitle ?? null,
      projectName: project.kind === 'project' ? project.projectName : null,
      total: 0,
      calls: summary?.calls ?? 0,
      peakContext: summary?.peakContext ?? 0,
      recache: 0,
      lastAt: summary?.lastAt ?? null,
      pullRequests: summary?.pullRequests ?? [],
    }
    sessions.set(key, created)
    return created
  }

  for (const [path, transcript] of index.transcripts) {
    for (const [key, tokens] of transcript.rows) {
      const parsed = parseRowKey(key)
      if (!parsed || !inWindow(parsed.utcHour)) continue
      const cost = costOf(parsed.model, tokens)
      if (!cost) continue
      split.total += totalCost(cost)
      split.input += cost.input
      split.output += cost.output
      split.cacheRead += cost.cacheRead
      cacheWrite += cost.cacheWrite
      sessionFor(path).total += totalCost(cost)
    }
    for (const [key, facet] of transcript.facets) {
      const parsed = parseFacetKey(key)
      if (!parsed || !inWindow(parsed.utcHour)) continue
      const spend = spendOf(parsed.model, facet.tokens)
      const [kind, value] = parsed.facet.split(':') as [string, string]
      if (kind === 'band') {
        const band = bands.get(value as ContextBand)
        if (!band) continue
        band.total += spend
        band.calls += facet.calls
      } else if (kind === 'recache' && (RECACHE_GAPS as readonly string[]).includes(value)) {
        split.recache += spend
        split.recacheByGap[value as RecacheGap] += spend
        sessionFor(path).recache += spend
      }
    }
  }
  split.otherCacheWrite = Math.max(0, cacheWrite - split.recache)

  return {
    split,
    byContextBand: [...bands.values()],
    topSessions: [...sessions.values()]
      .filter((session) => session.total > 0)
      .sort((left, right) => right.total - left.total)
      .slice(0, TOP_SESSIONS),
  }
}
