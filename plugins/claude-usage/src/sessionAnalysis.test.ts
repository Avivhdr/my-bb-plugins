import { describe, expect, it } from 'vitest'
import { analyzeSession, contextBandOf, parseFacetKey } from './sessionAnalysis'
import type { BilledResponse } from './transcript'

const START = Date.parse('2026-08-27T09:00:00.000Z')
const MINUTE = 60_000

function call(minute: number, tokens: Partial<BilledResponse['tokens']>, id = `msg_${minute}`): BilledResponse {
  return {
    messageId: id,
    model: 'claude-opus-5',
    timestamp: START + minute * MINUTE,
    cwd: '/worktrees/thr_1',
    tokens: { input: 0, output: 100, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...tokens },
  }
}

function facets(responses: BilledResponse[]) {
  const { facets } = analyzeSession(responses)
  return [...facets].map(([key, value]) => ({ ...parseFacetKey(key)!, ...value }))
}

describe('contextBandOf', () => {
  it('puts each boundary in the band above it', () => {
    expect(contextBandOf(99_999)).toBe('under100k')
    expect(contextBandOf(100_000)).toBe('100kTo250k')
    expect(contextBandOf(250_000)).toBe('250kTo500k')
    expect(contextBandOf(500_000)).toBe('over500k')
  })
})

describe('analyzeSession', () => {
  it('flags a call that rewrites its context after a pause past the cache lifetime', () => {
    const recache = facets([
      call(0, { cacheWrite5m: 200_000 }),
      call(1, { cacheRead: 200_000 }),
      call(12, { cacheWrite5m: 190_000, cacheRead: 10_000 }),
    ]).filter((facet) => facet.facet.startsWith('recache:'))

    expect(recache).toEqual([
      expect.objectContaining({
        facet: 'recache:5to15m',
        calls: 1,
        tokens: { input: 0, output: 0, cacheWrite5m: 190_000, cacheWrite1h: 0, cacheRead: 0 },
      }),
    ])
  })

  it('does not flag the first call, a short pause, or a pause the cache survived', () => {
    const recache = facets([
      call(0, { cacheWrite5m: 200_000 }),
      call(3, { cacheWrite5m: 200_000 }),
      call(40, { cacheWrite1h: 5_000, cacheRead: 200_000 }),
    ]).filter((facet) => facet.facet.startsWith('recache:'))

    expect(recache).toEqual([])
  })

  it('ignores re-caching a small context, which costs cents', () => {
    const recache = facets([call(0, { cacheWrite5m: 5_000 }), call(30, { cacheWrite5m: 5_000 })]).filter((facet) =>
      facet.facet.startsWith('recache:'),
    )

    expect(recache).toEqual([])
  })

  it('counts calls and tokens per context band', () => {
    const bands = facets([
      call(0, { cacheWrite5m: 50_000 }),
      call(1, { cacheRead: 60_000 }),
      call(2, { cacheRead: 300_000 }),
    ]).filter((facet) => facet.facet.startsWith('band:'))

    expect(bands.map(({ facet, calls }) => ({ facet, calls }))).toEqual([
      { facet: 'band:under100k', calls: 2 },
      { facet: 'band:250kTo500k', calls: 1 },
    ])
  })

  it('summarizes the session in time order, whatever order the responses arrive in', () => {
    const { session } = analyzeSession(
      [call(5, { cacheRead: 300_000, cacheWrite1h: 1_000 }), call(0, { cacheWrite5m: 400_000 })],
      { title: 'Fix the panel', pullRequests: ['https://github.com/o/r/pull/1', 'https://github.com/o/r/pull/1'] },
    )

    expect(session).toEqual({
      title: 'Fix the panel',
      cwd: '/worktrees/thr_1',
      model: 'claude-opus-5',
      firstAt: START,
      lastAt: START + 5 * MINUTE,
      calls: 2,
      peakContext: 400_000,
      lastContext: 301_000,
      cacheTtl: '1h',
      pullRequests: ['https://github.com/o/r/pull/1'],
    })
  })
})
