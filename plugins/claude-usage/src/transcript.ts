import { EMPTY_TOKENS, type TokenTotals } from './pricing'

export interface BilledResponse {
  messageId: string
  model: string
  /** Epoch milliseconds. */
  timestamp: number
  /** The working directory Claude Code recorded for the response. */
  cwd: string
  tokens: TokenTotals
}

interface RawUsage {
  input_tokens?: unknown
  output_tokens?: unknown
  cache_creation_input_tokens?: unknown
  cache_read_input_tokens?: unknown
  cache_creation?: { ephemeral_5m_input_tokens?: unknown; ephemeral_1h_input_tokens?: unknown }
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function readTokens(usage: RawUsage): TokenTotals {
  const split = usage.cache_creation
  const has5m = typeof split?.ephemeral_5m_input_tokens === 'number'
  const has1h = typeof split?.ephemeral_1h_input_tokens === 'number'
  return {
    input: count(usage.input_tokens),
    output: count(usage.output_tokens),
    // Only the split carries the 5m/1h distinction the two cache-write rates
    // need. Transcripts without it predate the split and were all 5m.
    cacheWrite5m: has5m || has1h ? count(split?.ephemeral_5m_input_tokens) : count(usage.cache_creation_input_tokens),
    cacheWrite1h: count(split?.ephemeral_1h_input_tokens),
    cacheRead: count(usage.cache_read_input_tokens),
  }
}

export function parseBilledResponse(line: string): BilledResponse | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null
  let record: Record<string, unknown>
  try {
    record = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return null
  }
  const message = record.message as { id?: unknown; model?: unknown; usage?: unknown } | undefined
  if (!message || typeof message.usage !== 'object' || message.usage === null) return null
  if (typeof message.id !== 'string' || typeof message.model !== 'string') return null
  if (typeof record.timestamp !== 'string' || typeof record.cwd !== 'string') return null
  const timestamp = Date.parse(record.timestamp)
  if (Number.isNaN(timestamp)) return null
  return {
    messageId: message.id,
    model: message.model,
    timestamp,
    cwd: record.cwd,
    tokens: readTokens(message.usage as RawUsage),
  }
}

/**
 * A single Billed Response is written once per content block, and a streamed
 * response's earlier records carry a partial `output_tokens` count. The last
 * record for a message id is the only complete one, so it replaces the rest.
 * Keeping the first instead undercounts output by roughly a quarter.
 */
export function collapseToBilledResponses(responses: Iterable<BilledResponse>): BilledResponse[] {
  const byMessageId = new Map<string, BilledResponse>()
  for (const response of responses) byMessageId.set(response.messageId, response)
  return [...byMessageId.values()]
}

export function isBillable(response: BilledResponse): boolean {
  return (
    response.tokens.input > 0 ||
    response.tokens.output > 0 ||
    response.tokens.cacheWrite5m > 0 ||
    response.tokens.cacheWrite1h > 0 ||
    response.tokens.cacheRead > 0
  )
}

export function emptyTokens(): TokenTotals {
  return { ...EMPTY_TOKENS }
}

/** Splits a chunked byte stream into lines, holding back the unfinished tail. */
export class LineAssembler {
  private pending = ''

  push(chunk: string): string[] {
    this.pending += chunk
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    return lines
  }

  flush(): string[] {
    if (this.pending.length === 0) return []
    const last = this.pending
    this.pending = ''
    return [last]
  }
}
