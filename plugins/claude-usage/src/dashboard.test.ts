import { describe, expect, it } from 'vitest'
import { buildAttributionMap } from './attribution'
import { buildDashboard, buildThreadSpend, localDayOf } from './dashboard'
import { emptySpendIndex, indexTranscript, mergeTranscript } from './spendIndex'
import type { BilledResponse } from './transcript'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')

const PROJECTS = [{ id: 'P-1', name: 'frontend', paths: ['/code/frontend'] }]
const ENVIRONMENTS = [{ id: 'E-1', projectId: 'P-1', path: '/worktrees/thr_1' }]
const THREAD = { id: 'thr_1', title: 'Fix the panel', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' }

const map = buildAttributionMap({ projects: PROJECTS, environments: ENVIRONMENTS, threads: [THREAD] })

function response(overrides: Partial<BilledResponse> = {}): BilledResponse {
  return {
    messageId: 'msg_1',
    model: 'claude-opus-5',
    timestamp: NOW,
    cwd: '/worktrees/thr_1',
    tokens: { input: 0, output: 1_000_000, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    ...overrides,
  }
}

function indexOf(...responses: BilledResponse[]) {
  const index = emptySpendIndex()
  responses.forEach((response, position) => {
    mergeTranscript(index, `${position}.jsonl`, indexTranscript([response], { sizeBytes: 1, modifiedAt: 1 }))
  })
  return index
}

describe('buildDashboard', () => {
  it('reports the same spend in every window that contains the response', () => {
    const dashboard = buildDashboard(indexOf(response()), map, NOW)

    expect(dashboard.totals.today.total).toBe(25)
    expect(dashboard.totals.last7Days.total).toBe(25)
    expect(dashboard.totals.allTime.total).toBe(25)
    expect(dashboard.runRatePerDay).toBeCloseTo(25 / 7)
  })

  it('excludes spend older than a window from that window but keeps it in all-time', () => {
    const old = response({ timestamp: NOW - 45 * 86_400_000 })

    const dashboard = buildDashboard(indexOf(old), map, NOW)

    expect(dashboard.totals.last30Days.total).toBe(0)
    expect(dashboard.totals.allTime.total).toBe(25)
  })

  it('counts a project’s thread work and its source-directory work in the project total', () => {
    const index = indexOf(response(), response({ cwd: '/code/frontend' }))

    const dashboard = buildDashboard(index, map, NOW)

    expect(dashboard.byProject).toEqual([{ key: 'project:P-1', label: 'frontend', projectName: null, total: 50 }])
    expect(dashboard.byThread).toEqual([
      { key: 'thread:thr_1', label: 'Fix the panel', projectName: 'frontend', total: 25 },
    ])
  })

  it('counts a response on both axes without doubling any total', () => {
    const dashboard = buildDashboard(indexOf(response()), map, NOW)

    expect(dashboard.byThread[0]!.total).toBe(25)
    expect(dashboard.byProject[0]!.total).toBe(25)
    expect(dashboard.totals.allTime.total).toBe(25)
    expect(dashboard.dailySeries.at(-1)!.total).toBe(25)
  })

  it('leaves every figure but the thread axis alone when no environment names a thread', () => {
    const index = indexOf(response(), response({ cwd: '/code/frontend' }))
    const shared = buildAttributionMap({
      projects: PROJECTS,
      environments: ENVIRONMENTS,
      threads: [THREAD, { ...THREAD, id: 'thr_2' }],
    })

    const blind = buildDashboard(index, shared, NOW)
    const sighted = buildDashboard(index, map, NOW)

    expect(blind.byThread).toEqual([])
    expect(sighted.byThread).not.toEqual([])
    expect(blind.totals).toEqual(sighted.totals)
    expect(blind.dailySeries).toEqual(sighted.dailySeries)
    expect(blind.byProject).toEqual(sighted.byProject)
    expect(blind.byModel).toEqual(sighted.byModel)
    expect(blind.outside).toEqual(sighted.outside)
  })

  it('reports spend outside every project instead of hiding it', () => {
    const dashboard = buildDashboard(indexOf(response({ cwd: '/elsewhere' })), map, NOW)

    expect(dashboard.outside.total).toBe(25)
    expect(dashboard.byProject).toEqual([{ key: 'outside', label: 'Outside BB', projectName: null, total: 25 }])
  })

  it('names an unpriced model and leaves its tokens out of every spend figure', () => {
    const dashboard = buildDashboard(indexOf(response({ model: 'claude-unreleased-9' })), map, NOW)

    expect(dashboard.unpricedModels).toEqual([{ model: 'claude-unreleased-9', tokens: 1_000_000 }])
    expect(dashboard.totals.allTime.total).toBe(0)
    expect(dashboard.byModel).toEqual([])
  })

  it('omits a zero-token model from the unpriced warning, since it costs nothing either way', () => {
    const free = response({
      model: '<synthetic>',
      tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 },
    })

    expect(buildDashboard(indexOf(free), map, NOW).unpricedModels).toEqual([])
  })

  it('emits one series point per local day, including days with no spend', () => {
    const dashboard = buildDashboard(indexOf(response()), map, NOW)

    expect(dashboard.dailySeries).toHaveLength(30)
    expect(dashboard.dailySeries.at(-1)).toMatchObject({ day: localDayOf(NOW), total: 25 })
    expect(dashboard.dailySeries.slice(0, -1).every((day) => day.total === 0)).toBe(true)
  })

  it('extends the series back to the first recorded day in whole 30-day windows', () => {
    const old = response({ timestamp: NOW - 45 * 86_400_000 })

    const dashboard = buildDashboard(indexOf(old, response()), map, NOW)

    expect(dashboard.dailySeries).toHaveLength(60)
    expect(dashboard.dailySeries[14]).toMatchObject({ day: localDayOf(old.timestamp), total: 25 })
    expect(dashboard.dailySeries.at(-1)).toMatchObject({ day: localDayOf(NOW), total: 25 })
  })

  it('gives every day of a long series its own calendar date across DST changes', () => {
    const old = response({ timestamp: NOW - 400 * 86_400_000 })

    const days = buildDashboard(indexOf(old), map, NOW).dailySeries.map((entry) => entry.day)

    expect(new Set(days).size).toBe(days.length)
    expect(days).toEqual([...days].sort())
  })

  it('splits spend across the cost components that produced it', () => {
    const mixed = response({
      tokens: { input: 1_000_000, output: 1_000_000, cacheWrite5m: 1_000_000, cacheWrite1h: 0, cacheRead: 1_000_000 },
    })

    expect(buildDashboard(indexOf(mixed), map, NOW).totals.allTime.breakdown).toEqual({
      input: 5,
      output: 25,
      cacheWrite: 6.25,
      cacheRead: 0.5,
    })
  })

  it('counts the transcripts behind the figures', () => {
    expect(buildDashboard(indexOf(response(), response()), map, NOW).transcriptCount).toBe(2)
  })

  it('returns zeroed totals for an empty index rather than failing', () => {
    const dashboard = buildDashboard(emptySpendIndex(), map, NOW)

    expect(dashboard.totals.allTime.total).toBe(0)
    expect(dashboard.byProject).toEqual([])
    expect(dashboard.earliestDay).toBeNull()
  })
})

describe('buildThreadSpend', () => {
  it('prices only the responses recorded in the thread’s own environment', () => {
    const index = indexOf(response(), response({ messageId: 'msg_2', cwd: '/code/frontend' }))

    expect(buildThreadSpend(index, map, 'thr_1')).toEqual({ threadId: 'thr_1', found: true, total: 25 })
  })

  it('sums every transcript recorded in the environment, not just the most recent', () => {
    const index = indexOf(response(), response({ messageId: 'msg_2' }))

    expect(buildThreadSpend(index, map, 'thr_1').total).toBe(50)
  })

  it('answers a thread with no transcripts without inventing a figure', () => {
    expect(buildThreadSpend(indexOf(response()), map, 'thr_unknown')).toEqual({
      threadId: 'thr_unknown',
      found: false,
      total: 0,
    })
  })

  it('claims a thread it has rows for even when they priced to nothing', () => {
    const free = response({ model: '<synthetic>' })

    expect(buildThreadSpend(indexOf(free), map, 'thr_1')).toEqual({ threadId: 'thr_1', found: true, total: 0 })
  })
})
