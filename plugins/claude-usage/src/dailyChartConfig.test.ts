import { describe, expect, it } from 'vitest'
import {
  buildDailyChartData,
  CHART_SERIES,
  dailyWindow,
  dayTotal,
  tooltipLine,
  tooltipTitle,
  type ChartPalette,
} from './dailyChartConfig'
import type { DailySpend } from './dashboard'

const palette: ChartPalette = {
  series: { cacheRead: 'cyan', cacheWrite: 'pink', output: 'indigo', input: 'teal' },
  text: 'black',
  grid: 'grey',
  surface: 'white',
}

function day(overrides: Partial<DailySpend> = {}): DailySpend {
  return {
    day: '2026-08-27',
    total: 10,
    breakdown: { input: 1, output: 2, cacheWrite: 3, cacheRead: 4 },
    ...overrides,
  }
}

describe('buildDailyChartData', () => {
  it('stacks every cost component into one bar per day', () => {
    const data = buildDailyChartData([day(), day({ day: '2026-08-26' })], palette)

    expect(data.labels).toEqual(['Aug 27', 'Aug 26'])
    expect(data.datasets).toHaveLength(CHART_SERIES.length)
    expect(data.datasets.every((set) => set.stack === 'spend')).toBe(true)
    expect(data.datasets.map((set) => set.data.length)).toEqual([2, 2, 2, 2])
  })

  it('lists cache read first so the largest component sits on the axis', () => {
    const data = buildDailyChartData([day()], palette)

    expect(data.datasets[0]).toMatchObject({ label: 'Cache read', data: [4], backgroundColor: 'cyan' })
    expect(data.datasets.at(-1)).toMatchObject({ label: 'Input', data: [1], backgroundColor: 'teal' })
  })

  it('keeps a zero day in the series so the axis still spans 30 days', () => {
    const empty = day({ day: '2026-08-01', total: 0, breakdown: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 } })

    const data = buildDailyChartData([empty], palette)

    expect(data.labels).toEqual(['Aug 1'])
    expect(data.datasets.map((set) => set.data[0])).toEqual([0, 0, 0, 0])
  })

  it('falls back to the text colour when a theme variable is missing', () => {
    const data = buildDailyChartData([day()], { ...palette, series: {} })

    expect(data.datasets.every((set) => set.backgroundColor === 'black')).toBe(true)
  })
})

describe('tooltip text', () => {
  it('titles the tooltip with the day and its total', () => {
    expect(tooltipTitle([day()], 0)).toBe('Aug 27 · $10.00')
  })

  it('returns nothing for an index the series does not cover', () => {
    expect(tooltipTitle([day()], 5)).toBe('')
  })

  it('gives each component its share of the day', () => {
    expect(tooltipLine('Cache read', 4, 10)).toBe('Cache read: $4.00 (40%)')
  })

  it('omits a component that did not contribute', () => {
    expect(tooltipLine('Input', 0, 10)).toBe('')
  })

  it('reads a day total by position', () => {
    expect(dayTotal([day({ total: 42 })], 0)).toBe(42)
    expect(dayTotal([], 0)).toBe(0)
  })
})

describe('dailyWindow', () => {
  const series = Array.from({ length: 60 }, (_, position) => day({ day: `d${position}` }))

  it('shows the newest 30 days first', () => {
    const window = dailyWindow(series, 0)

    expect(window.days.map((entry) => entry.day)).toEqual(series.slice(30).map((entry) => entry.day))
    expect(window).toMatchObject({ windowsBack: 0, hasOlder: true, hasNewer: false })
  })

  it('steps back one 30-day window per offset', () => {
    const window = dailyWindow(series, 1)

    expect(window.days.map((entry) => entry.day)).toEqual(series.slice(0, 30).map((entry) => entry.day))
    expect(window).toMatchObject({ windowsBack: 1, hasOlder: false, hasNewer: true })
  })

  it('stops at the oldest window when asked to go further back', () => {
    expect(dailyWindow(series, 5)).toMatchObject({ windowsBack: 1, hasOlder: false })
  })
})
