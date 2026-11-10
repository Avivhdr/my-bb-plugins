import { describe, expect, it } from 'vitest'
import { buildAttributionMap } from './attribution'
import { buildInsights, parentTranscriptOf } from './insights'
import { emptySpendIndex, indexTranscript, mergeTranscript } from './spendIndex'
import type { BilledResponse } from './transcript'

const START = Date.parse('2026-08-27T09:00:00.000Z')
const MINUTE = 60_000

const map = buildAttributionMap({
  projects: [{ id: 'P-1', name: 'frontend', paths: ['/code/frontend'] }],
  environments: [{ id: 'E-1', projectId: 'P-1', path: '/worktrees/thr_1' }],
  threads: [{ id: 'thr_1', title: 'Fix the panel', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' }],
})

function call(minute: number, tokens: Partial<BilledResponse['tokens']>): BilledResponse {
  return {
    messageId: `msg_${minute}`,
    model: 'claude-opus-5',
    timestamp: START + minute * MINUTE,
    cwd: '/worktrees/thr_1',
    tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, ...tokens },
  }
}

const STAT = { sizeBytes: 1, modifiedAt: 1 }

describe('parentTranscriptOf', () => {
  it('maps a subagent transcript onto its parent session', () => {
    expect(parentTranscriptOf('proj/abc/subagents/agent-1.jsonl')).toBe('proj/abc.jsonl')
    expect(parentTranscriptOf('proj/abc.jsonl')).toBe('proj/abc.jsonl')
  })
})

describe('buildInsights', () => {
  it('splits re-caching after a pause out of the other cache writes', () => {
    const index = emptySpendIndex()
    mergeTranscript(
      index,
      'proj/s.jsonl',
      indexTranscript(
        [call(0, { cacheWrite5m: 400_000 }), call(1, { cacheRead: 400_000 }), call(20, { cacheWrite5m: 400_000 })],
        STAT,
        { title: 'Fix the panel', pullRequests: ['https://github.com/o/r/pull/7'] },
      ),
    )

    const { split, topSessions } = buildInsights(index, map, START)

    // claude-opus-5 writes the 5-minute cache at $6.25 and reads at $0.50 per million.
    expect(split.recache).toBeCloseTo(2.5)
    expect(split.recacheByGap['15to60m']).toBeCloseTo(2.5)
    expect(split.otherCacheWrite).toBeCloseTo(2.5)
    expect(split.cacheRead).toBeCloseTo(0.2)
    expect(topSessions).toEqual([
      expect.objectContaining({
        key: 'proj/s.jsonl',
        title: 'Fix the panel',
        projectName: 'frontend',
        calls: 3,
        peakContext: 400_000,
        pullRequests: ['https://github.com/o/r/pull/7'],
      }),
    ])
    expect(topSessions[0]!.total).toBeCloseTo(5.2)
    expect(topSessions[0]!.recache).toBeCloseTo(2.5)
  })

  it('adds subagent spend to the session that launched it', () => {
    const index = emptySpendIndex()
    mergeTranscript(index, 'proj/s.jsonl', indexTranscript([call(0, { output: 1_000_000 })], STAT))
    mergeTranscript(index, 'proj/s/subagents/a.jsonl', indexTranscript([call(1, { output: 1_000_000 })], STAT))

    const { topSessions } = buildInsights(index, map, START)

    expect(topSessions).toHaveLength(1)
    expect(topSessions[0]!.total).toBeCloseTo(50)
  })

  it('counts calls per context band and leaves out spend before the window', () => {
    const index = emptySpendIndex()
    mergeTranscript(
      index,
      'proj/s.jsonl',
      indexTranscript([call(-120, { cacheRead: 600_000 }), call(0, { cacheRead: 50_000 }), call(1, { cacheRead: 600_000 })], STAT),
    )

    const { byContextBand } = buildInsights(index, map, START)

    expect(byContextBand.map(({ band, calls }) => ({ band, calls }))).toEqual([
      { band: 'under100k', calls: 1 },
      { band: '100kTo250k', calls: 0 },
      { band: '250kTo500k', calls: 0 },
      { band: 'over500k', calls: 1 },
    ])
  })
})
