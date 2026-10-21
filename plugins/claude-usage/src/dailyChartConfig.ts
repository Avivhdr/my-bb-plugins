import type { CostBreakdown } from './pricing'
import type { DailySpend } from './dashboard'
import { formatDayLabel, formatMoney } from './format'

export const DAILY_SERIES_DAYS = 30

export interface ChartSeries {
  key: keyof CostBreakdown
  label: string
  cssVariable: string
  /** Painted when the theme does not define `cssVariable`, so no segment is ever blank. */
  fallback: string
}

export const CHART_SERIES: readonly ChartSeries[] = [
  { key: 'cacheRead', label: 'Cache read', cssVariable: '--chart-1', fallback: '#3b82f6' },
  { key: 'cacheWrite', label: 'Cache write', cssVariable: '--chart-2', fallback: '#14b8a6' },
  { key: 'output', label: 'Output', cssVariable: '--chart-3', fallback: '#f59e0b' },
  { key: 'input', label: 'Input', cssVariable: '--chart-4', fallback: '#a855f7' },
]

export interface ChartPalette {
  series: Record<string, string>
  text: string
  grid: string
  surface: string
}

export interface DailyChartData {
  labels: string[]
  datasets: Array<{
    label: string
    data: number[]
    backgroundColor: string
    borderWidth: number
    borderRadius: number
    stack: string
  }>
}

/**
 * Stacked bottom-up, so the series order here is the visual order from the axis
 * upward and reversing it would put the largest slice on top.
 */
export function buildDailyChartData(series: DailySpend[], palette: ChartPalette): DailyChartData {
  return {
    labels: series.map((day) => formatDayLabel(day.day)),
    datasets: CHART_SERIES.map((entry) => ({
      label: entry.label,
      data: series.map((day) => day.breakdown[entry.key]),
      backgroundColor: palette.series[entry.key] ?? palette.text,
      borderWidth: 0,
      borderRadius: 2,
      stack: 'spend',
    })),
  }
}

export interface DailyWindow {
  days: DailySpend[]
  windowsBack: number
  hasOlder: boolean
  hasNewer: boolean
}

export function dailyWindow(series: DailySpend[], windowsBack: number): DailyWindow {
  const oldest = Math.max(0, series.length / DAILY_SERIES_DAYS - 1)
  const clamped = Math.min(Math.max(0, windowsBack), oldest)
  const end = series.length - clamped * DAILY_SERIES_DAYS
  return {
    days: series.slice(end - DAILY_SERIES_DAYS, end),
    windowsBack: clamped,
    hasOlder: clamped < oldest,
    hasNewer: clamped > 0,
  }
}

export function dayTotal(series: DailySpend[], index: number): number {
  return series[index]?.total ?? 0
}

export function tooltipTitle(series: DailySpend[], index: number): string {
  const day = series[index]
  if (!day) return ''
  return `${formatDayLabel(day.day)} · ${formatMoney(day.total)}`
}

export function tooltipLine(label: string, value: number, total: number): string {
  if (value <= 0) return ''
  const share = total > 0 ? Math.round((value / total) * 100) : 0
  return `${label}: ${formatMoney(value)} (${share}%)`
}
