import { formatMoney, formatTokens } from './format'
import type { CacheTtl } from './sessionAnalysis'

/** One running or recently used session, as the live tracker last read it. */
export interface LiveSession {
  path: string
  title: string | null
  threadId: string | null
  threadTitle: string | null
  projectName: string | null
  model: string
  /** When the session's last response arrived, epoch milliseconds. */
  lastAt: number
  /** Tokens the next call sends before it generates anything. */
  context: number
  cacheTtl: CacheTtl
  /** What the next call costs to write the whole context to the cache again. */
  recacheCost: number
  /** What the next call costs to read the context while the cache is still warm. */
  warmCallCost: number
  /** What generating a compaction summary costs, on top of reading the context once. */
  summaryOutputCost: number
  /** What a call costs to read a freshly compacted context. */
  compactedCallCost: number
}

export type AdviceLevel = 'none' | 'large' | 'expiring' | 'cold'

export interface Advice {
  level: AdviceLevel
  idleMs: number
  /** Time left before the cache expires; zero once it has. */
  warmRemainingMs: number
  /** What a pause past the cache lifetime adds to the next call. */
  recachePenalty: number
  headline: string
  detail: string
  /** What the next message costs right now, filled for every level. */
  summary: string
  /** What compacting costs right now: one read of the context, warm or not, plus the summary. */
  compactCost: number
  /** What each later step saves once the context is compacted. */
  stepSavings: number
}

const MINUTE_MS = 60_000
const TTL_MS: Record<CacheTtl, number> = { '5m': 5 * MINUTE_MS, '1h': 60 * MINUTE_MS }
/** A re-cache cheaper than this is not worth interrupting anyone for. */
export const RECACHE_ALERT_USD = 1
/** Past this, every step is expensive enough to suggest a fresh thread. */
export const LARGE_CONTEXT_TOKENS = 300_000
/** Warn this long before the cache expires, so there is time to reply. */
const EXPIRING_WINDOW_MS = 2 * MINUTE_MS

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / MINUTE_MS)
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} days`
}

/**
 * `running` means the agent is mid-turn: a long tool call can outlast the
 * cache too, but nobody can reply to save it, so it is never flagged as cold.
 */
export function assessSession(session: LiveSession, now: number, running = false): Advice {
  const idleMs = Math.max(0, now - session.lastAt)
  const ttlMs = TTL_MS[session.cacheTtl]
  const warmRemainingMs = Math.max(0, ttlMs - idleMs)
  const recachePenalty = Math.max(0, session.recacheCost - session.warmCallCost)
  const context = formatTokens(session.context)
  const summary =
    warmRemainingMs > 0 || running
      ? `Next message about ${formatMoney(session.warmCallCost)} while the cache is warm` +
        (running ? '' : ` (${formatDuration(warmRemainingMs)} left), then ${formatMoney(session.recacheCost)}`)
      : `Next message about ${formatMoney(session.recacheCost)}: the cache expired ${formatDuration(idleMs - ttlMs)} ago`
  const compactCost =
    (warmRemainingMs > 0 ? session.warmCallCost : session.recacheCost) + session.summaryOutputCost
  const stepSavings = Math.max(0, session.warmCallCost - session.compactedCallCost)
  const base = { idleMs, warmRemainingMs, recachePenalty, summary, compactCost, stepSavings }
  const worthAlerting = session.recacheCost >= RECACHE_ALERT_USD

  if (!running && warmRemainingMs === 0 && worthAlerting) {
    return {
      ...base,
      level: 'cold',
      headline: `Your next message re-sends ${context} tokens, about ${formatMoney(session.recacheCost)}`,
      detail:
        `The prompt cache expired ${formatDuration(idleMs - ttlMs)} ago, so the first call writes this whole ` +
        `conversation to the cache again. Compacting pays that once (about ${formatMoney(compactCost)}), then ` +
        `each step costs about ${formatMoney(session.compactedCallCost)} instead of ${formatMoney(session.warmCallCost)}.`,
    }
  }
  if (!running && warmRemainingMs > 0 && warmRemainingMs <= EXPIRING_WINDOW_MS && worthAlerting) {
    return {
      ...base,
      level: 'expiring',
      headline: `Cache expires in ${formatDuration(warmRemainingMs)}`,
      detail:
        `Compact now for about ${formatMoney(compactCost)} while the cache is warm. After it expires, coming back ` +
        `costs ${formatMoney(session.recacheCost)} just to re-cache ${context} tokens.`,
    }
  }
  if (session.context >= LARGE_CONTEXT_TOKENS) {
    return {
      ...base,
      level: 'large',
      headline: `This conversation is ${context} tokens`,
      detail:
        `Every step re-reads all of it, about ${formatMoney(session.warmCallCost)} per call, and a pause over ` +
        `${formatDuration(ttlMs)} costs ${formatMoney(session.recacheCost)} to re-cache. Compacting now costs about ` +
        `${formatMoney(compactCost)} and brings each step down to about ${formatMoney(session.compactedCallCost)}.`,
    }
  }
  return { ...base, level: 'none', headline: '', detail: '' }
}

/** One message runs about ten model calls: the average across this machine's transcripts in October 2026. */
export const STEPS_PER_MESSAGE = 10

export interface Projection {
  messages: number
  /** Keep going without compacting: re-cache once if the cache expired, then every step re-reads it all. */
  asIs: number
  /** Compact now, cache the small context once, then every step reads that. */
  compacted: number
  saving: number
}

/**
 * Prices the next `messages` messages both ways. It leaves out what Claude
 * writes, which costs the same either way, and the context growing as the
 * work goes on, which only widens the gap, so the saving is a floor.
 */
export function projectMessages(session: LiveSession, advice: Advice, messages: number): Projection {
  const steps = messages * STEPS_PER_MESSAGE
  const asIs = (advice.warmRemainingMs === 0 ? session.recacheCost : 0) + steps * session.warmCallCost
  // Writing a context costs the same multiple of reading it whatever its size.
  const writeToRead = session.warmCallCost > 0 ? session.recacheCost / session.warmCallCost : 0
  const compacted = advice.compactCost + session.compactedCallCost * writeToRead + steps * session.compactedCallCost
  return { messages, asIs, compacted, saving: Math.max(0, asIs - compacted) }
}
