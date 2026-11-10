import { describe, expect, it } from 'vitest'
import { assessSession, projectMessages, type LiveSession } from './advice'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')
const MINUTE = 60_000

function session(overrides: Partial<LiveSession> = {}): LiveSession {
  return {
    path: 'proj/s.jsonl',
    title: 'Fix the panel',
    threadId: 'thr_1',
    threadTitle: 'Fix the panel',
    projectName: 'frontend',
    model: 'claude-opus-5',
    lastAt: NOW - MINUTE,
    context: 600_000,
    cacheTtl: '5m',
    recacheCost: 3.75,
    warmCallCost: 0.3,
    summaryOutputCost: 0.2,
    compactedCallCost: 0.015,
    ...overrides,
  }
}

describe('assessSession', () => {
  it('warns that the next message re-caches once the cache has expired', () => {
    const advice = assessSession(session({ lastAt: NOW - 12 * MINUTE }), NOW)

    expect(advice.level).toBe('cold')
    expect(advice.headline).toBe('Your next message re-sends 600K tokens, about $3.75')
    expect(advice.detail).toContain('expired 7 min ago')
    expect(advice.recachePenalty).toBeCloseTo(3.45)
  })

  it('counts down the last two minutes of a warm cache', () => {
    const advice = assessSession(session({ lastAt: NOW - 4 * MINUTE }), NOW)

    expect(advice.level).toBe('expiring')
    expect(advice.headline).toBe('Cache expires in 1 min')
  })

  it('suggests a fresh thread for a large conversation with a warm cache', () => {
    expect(assessSession(session(), NOW).level).toBe('large')
  })

  it('never calls a running turn cold, since nobody can reply to save the cache', () => {
    expect(assessSession(session({ lastAt: NOW - 12 * MINUTE }), NOW, true).level).toBe('large')
  })

  it('stays quiet when the re-cache is cheap and the context small', () => {
    const advice = assessSession(
      session({ lastAt: NOW - 30 * MINUTE, context: 40_000, recacheCost: 0.25, warmCallCost: 0.02 }),
      NOW,
    )

    expect(advice.level).toBe('none')
  })

  it('keeps a one-hour cache warm through a half-hour pause', () => {
    const advice = assessSession(session({ cacheTtl: '1h', lastAt: NOW - 30 * MINUTE }), NOW)

    expect(advice.level).toBe('large')
    expect(advice.warmRemainingMs).toBe(30 * MINUTE)
  })
})

describe('projectMessages', () => {
  it('prices ten messages with and without compacting a cold conversation', () => {
    const cold = session({ lastAt: NOW - 12 * MINUTE })
    const projection = projectMessages(cold, assessSession(cold, NOW), 10)

    // As is: re-cache $3.75, then 100 steps at $0.30.
    expect(projection.asIs).toBeCloseTo(33.75)
    // Compacted: $3.95 to compact, $0.1875 to cache the small context, 100 steps at $0.015.
    expect(projection.compacted).toBeCloseTo(5.6375)
    expect(projection.saving).toBeCloseTo(28.1125)
  })

  it('leaves the re-cache out of the as-is price while the cache is warm', () => {
    const projection = projectMessages(session(), assessSession(session(), NOW), 1)

    expect(projection.asIs).toBeCloseTo(3)
  })
})
