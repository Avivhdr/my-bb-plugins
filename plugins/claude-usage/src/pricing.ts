export interface TokenTotals {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export interface CostBreakdown {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
}

/** Anthropic list prices in USD per million tokens. */
interface ModelPrice extends TokenTotals {}

const OPUS_5_5: ModelPrice = { input: 4, output: 20, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2 }
const OPUS: ModelPrice = { input: 5, output: 25, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5 }
const SONNET: ModelPrice = { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 }
const HAIKU: ModelPrice = { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 }

export const PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': OPUS_5_5,
  'claude-opus-5': OPUS,
  'claude-opus-4-8': OPUS,
  'claude-opus-4-7': OPUS,
  'claude-opus-4-6': OPUS,
  'claude-sonnet-5-5': SONNET,
  'claude-sonnet-5': SONNET,
  'claude-sonnet-4-6': SONNET,
  'claude-sonnet-4-5': SONNET,
  'claude-haiku-4-5': HAIKU,
}

export const EMPTY_TOKENS: Readonly<TokenTotals> = {
  input: 0,
  output: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  cacheRead: 0,
}

/**
 * Collapses the model ids a transcript can carry onto Price Table keys. The
 * `[1m]` long-context suffix bills at the base model's rates, verified against
 * Claude Code's own per-model cost totals, so it is not a separate entry.
 * Only a date suffix is stripped: a prefix match would price `claude-opus-5-5`
 * as `claude-opus-5`.
 */
export function normalizeModelId(modelId: string): string {
  return modelId.split('[')[0]!.trim().replace(/-\d{8}$/, '')
}

export function isPricedModel(modelId: string): boolean {
  return normalizeModelId(modelId) in PRICE_TABLE
}

export function addTokens(target: TokenTotals, addend: TokenTotals): TokenTotals {
  return {
    input: target.input + addend.input,
    output: target.output + addend.output,
    cacheWrite5m: target.cacheWrite5m + addend.cacheWrite5m,
    cacheWrite1h: target.cacheWrite1h + addend.cacheWrite1h,
    cacheRead: target.cacheRead + addend.cacheRead,
  }
}

export function totalTokenCount(tokens: TokenTotals): number {
  return tokens.input + tokens.output + tokens.cacheWrite5m + tokens.cacheWrite1h + tokens.cacheRead
}

/** Returns null for an Unpriced Model rather than a zero or a guessed rate. */
export function costOf(modelId: string, tokens: TokenTotals): CostBreakdown | null {
  const price = PRICE_TABLE[normalizeModelId(modelId)]
  if (!price) return null
  return {
    input: (tokens.input * price.input) / 1_000_000,
    output: (tokens.output * price.output) / 1_000_000,
    cacheWrite:
      (tokens.cacheWrite5m * price.cacheWrite5m + tokens.cacheWrite1h * price.cacheWrite1h) / 1_000_000,
    cacheRead: (tokens.cacheRead * price.cacheRead) / 1_000_000,
  }
}

export function totalCost(cost: CostBreakdown): number {
  return cost.input + cost.output + cost.cacheWrite + cost.cacheRead
}

export const EMPTY_COST: Readonly<CostBreakdown> = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }

export function addCost(target: CostBreakdown, addend: CostBreakdown): CostBreakdown {
  return {
    input: target.input + addend.input,
    output: target.output + addend.output,
    cacheWrite: target.cacheWrite + addend.cacheWrite,
    cacheRead: target.cacheRead + addend.cacheRead,
  }
}
