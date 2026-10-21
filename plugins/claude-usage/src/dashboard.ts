import { attribute, type AttributionMap } from './attribution'
import { DAILY_SERIES_DAYS } from './dailyChartConfig'
import {
  addCost,
  addTokens,
  costOf,
  EMPTY_COST,
  EMPTY_TOKENS,
  isPricedModel,
  normalizeModelId,
  totalCost,
  type CostBreakdown,
  type TokenTotals,
} from './pricing'
import { iterateRows, timestampOfUtcHour, type SpendIndex } from './spendIndex'

export interface SpendFigure {
  total: number
  breakdown: CostBreakdown
  tokens: TokenTotals
}

export interface DailySpend {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string
  total: number
  breakdown: CostBreakdown
}

export interface ScopeSpend {
  key: string
  label: string
  projectName: string | null
  total: number
}

export interface ModelSpend {
  model: string
  total: number
  tokens: number
}

export interface UnpricedModel {
  model: string
  tokens: number
}

export interface SpendDashboardData {
  generatedAt: number
  totals: { allTime: SpendFigure; last30Days: SpendFigure; last7Days: SpendFigure; today: SpendFigure }
  runRatePerDay: number
  dailySeries: DailySpend[]
  byProject: ScopeSpend[]
  byThread: ScopeSpend[]
  byModel: ModelSpend[]
  unpricedModels: UnpricedModel[]
  outside: SpendFigure
  transcriptCount: number
  earliestDay: string | null
  latestDay: string | null
}

const DAY_MS = 86_400_000
const TOP_THREADS = 15

function emptyFigure(): SpendFigure {
  return { total: 0, breakdown: { ...EMPTY_COST }, tokens: { ...EMPTY_TOKENS } }
}

function addToFigure(figure: SpendFigure, cost: CostBreakdown | null, tokens: TokenTotals): void {
  figure.tokens = addTokens(figure.tokens, tokens)
  if (!cost) return
  figure.breakdown = addCost(figure.breakdown, cost)
  figure.total += totalCost(cost)
}

/** `YYYY-MM-DD` in the host's own timezone, so DST shifts are handled by Date. */
export function localDayOf(timestamp: number): string {
  const date = new Date(timestamp)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function localDaysBetween(earlierDay: string, laterDayStart: number): number {
  const [year, month, dayOfMonth] = earlierDay.split('-').map(Number)
  return Math.round((laterDayStart - new Date(year!, month! - 1, dayOfMonth!).getTime()) / DAY_MS)
}

function dailySeriesUpTo(
  todayStart: number,
  daily: Map<string, { total: number; breakdown: CostBreakdown }>,
  earliestDay: string | null,
): DailySpend[] {
  const daysOfHistory = earliestDay ? localDaysBetween(earliestDay, todayStart) + 1 : 0
  const length = Math.max(1, Math.ceil(daysOfHistory / DAILY_SERIES_DAYS)) * DAILY_SERIES_DAYS
  const cursor = new Date(todayStart)
  const series: DailySpend[] = []
  for (let position = 0; position < length; position += 1) {
    const day = localDayOf(cursor.getTime())
    const bucket = daily.get(day)
    series.push({ day, total: bucket?.total ?? 0, breakdown: bucket?.breakdown ?? { ...EMPTY_COST } })
    cursor.setDate(cursor.getDate() - 1)
  }
  return series.reverse()
}

const OUTSIDE = { key: 'outside', label: 'Outside BB' }

export function buildDashboard(
  index: SpendIndex,
  attributionMap: AttributionMap,
  now: number,
): SpendDashboardData {
  const totals = {
    allTime: emptyFigure(),
    last30Days: emptyFigure(),
    last7Days: emptyFigure(),
    today: emptyFigure(),
  }
  const outside = emptyFigure()
  const daily = new Map<string, { total: number; breakdown: CostBreakdown }>()
  const projects = new Map<string, ScopeSpend>()
  const threads = new Map<string, ScopeSpend>()
  const models = new Map<string, ModelSpend>()
  const unpriced = new Map<string, number>()
  let earliestDay: string | null = null
  let latestDay: string | null = null

  const todayStart = startOfLocalDay(now)
  const sevenDayStart = todayStart - 6 * DAY_MS
  const thirtyDayStart = todayStart - (DAILY_SERIES_DAYS - 1) * DAY_MS

  for (const row of iterateRows(index)) {
    const timestamp = timestampOfUtcHour(row.utcHour)
    if (Number.isNaN(timestamp)) continue
    const day = localDayOf(timestamp)
    if (!earliestDay || day < earliestDay) earliestDay = day
    if (!latestDay || day > latestDay) latestDay = day

    const model = normalizeModelId(row.model)
    const cost = costOf(row.model, row.tokens)
    const tokenCount =
      row.tokens.input +
      row.tokens.output +
      row.tokens.cacheWrite5m +
      row.tokens.cacheWrite1h +
      row.tokens.cacheRead

    if (!isPricedModel(row.model)) {
      if (tokenCount > 0) unpriced.set(model, (unpriced.get(model) ?? 0) + tokenCount)
    } else {
      const existing = models.get(model) ?? { model, total: 0, tokens: 0 }
      existing.total += cost ? totalCost(cost) : 0
      existing.tokens += tokenCount
      models.set(model, existing)
    }

    addToFigure(totals.allTime, cost, row.tokens)
    if (timestamp >= thirtyDayStart) addToFigure(totals.last30Days, cost, row.tokens)
    if (timestamp >= sevenDayStart) addToFigure(totals.last7Days, cost, row.tokens)
    if (timestamp >= todayStart) addToFigure(totals.today, cost, row.tokens)

    if (cost) {
      const bucket = daily.get(day) ?? { total: 0, breakdown: { ...EMPTY_COST } }
      bucket.breakdown = addCost(bucket.breakdown, cost)
      bucket.total += totalCost(cost)
      daily.set(day, bucket)
    }

    const spend = cost ? totalCost(cost) : 0

    const { project, thread } = attribute(attributionMap, row.cwd)
    if (project.kind === 'outside') addToFigure(outside, cost, row.tokens)
    const projectScope =
      project.kind === 'outside'
        ? OUTSIDE
        : { key: `project:${project.projectId}`, label: project.projectName }
    const projectEntry = projects.get(projectScope.key) ?? { ...projectScope, projectName: null, total: 0 }
    projectEntry.total += spend
    projects.set(projectScope.key, projectEntry)

    if (thread) {
      const key = `thread:${thread.threadId}`
      const entry = threads.get(key) ?? {
        key,
        label: thread.threadTitle,
        projectName: thread.projectName,
        total: 0,
      }
      entry.total += spend
      threads.set(key, entry)
    }
  }

  const dailySeries = dailySeriesUpTo(todayStart, daily, earliestDay)

  const byDescendingTotal = (left: { total: number }, right: { total: number }) => right.total - left.total

  return {
    generatedAt: now,
    totals,
    runRatePerDay: totals.last7Days.total / 7,
    dailySeries,
    byProject: [...projects.values()].filter((entry) => entry.total > 0).sort(byDescendingTotal),
    byThread: [...threads.values()].filter((entry) => entry.total > 0).sort(byDescendingTotal).slice(0, TOP_THREADS),
    byModel: [...models.values()].filter((entry) => entry.tokens > 0).sort(byDescendingTotal),
    unpricedModels: [...unpriced.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((left, right) => right.tokens - left.tokens),
    outside,
    transcriptCount: index.transcripts.size,
    earliestDay,
    latestDay,
  }
}

export interface ThreadSpendData {
  threadId: string
  found: boolean
  total: number
}

export function buildThreadSpend(
  index: SpendIndex,
  attributionMap: AttributionMap,
  threadId: string,
): ThreadSpendData {
  let total = 0
  let found = false

  for (const row of iterateRows(index)) {
    if (Number.isNaN(timestampOfUtcHour(row.utcHour))) continue
    if (attribute(attributionMap, row.cwd).thread?.threadId !== threadId) continue
    found = true
    const cost = costOf(row.model, row.tokens)
    if (cost) total += totalCost(cost)
  }

  return { threadId, found, total }
}
