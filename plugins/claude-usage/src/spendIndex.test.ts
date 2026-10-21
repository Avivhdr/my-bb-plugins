import { describe, expect, it } from 'vitest'
import {
  emptySpendIndex,
  indexTranscript,
  iterateRows,
  mergeTranscript,
  needsRescan,
  utcHourOf,
} from './spendIndex'
import type { BilledResponse } from './transcript'

function response(overrides: Partial<BilledResponse> = {}): BilledResponse {
  return {
    messageId: 'msg_1',
    model: 'claude-opus-5',
    timestamp: Date.parse('2026-08-27T09:15:00.000Z'),
    cwd: '/Users/dev/project',
    tokens: { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 },
    ...overrides,
  }
}

const STAT = { sizeBytes: 100, modifiedAt: 1 }

describe('utcHourOf', () => {
  it('buckets by UTC hour so stored rows do not depend on the aggregating timezone', () => {
    expect(utcHourOf(Date.parse('2026-08-27T09:59:59.999Z'))).toBe('2026-08-27T09')
  })
})

describe('indexTranscript', () => {
  it('sums responses that share a directory, hour, and model', () => {
    const transcript = indexTranscript([response(), response({ messageId: 'msg_2' })], STAT)

    expect([...transcript.rows.values()]).toEqual([
      { input: 2, output: 4, cacheWrite5m: 6, cacheWrite1h: 8, cacheRead: 10 },
    ])
  })

  it('keeps different hours in separate rows', () => {
    const later = response({ timestamp: Date.parse('2026-08-27T10:00:00.000Z') })

    expect(indexTranscript([response(), later], STAT).rows.size).toBe(2)
  })

  it('keeps different working directories in separate rows', () => {
    expect(indexTranscript([response(), response({ cwd: '/Users/dev/other' })], STAT).rows.size).toBe(2)
  })
})

describe('mergeTranscript', () => {
  it('replaces one transcript without disturbing the others', () => {
    const index = emptySpendIndex()
    mergeTranscript(index, 'a.jsonl', indexTranscript([response()], STAT))
    mergeTranscript(index, 'b.jsonl', indexTranscript([response({ cwd: '/b' })], STAT))

    mergeTranscript(index, 'a.jsonl', indexTranscript([response(), response({ messageId: 'msg_2' })], STAT))

    expect(index.transcripts.size).toBe(2)
    expect(index.transcripts.get('a.jsonl')!.rows.get([...index.transcripts.get('a.jsonl')!.rows.keys()][0]!)).toEqual(
      { input: 2, output: 4, cacheWrite5m: 6, cacheWrite1h: 8, cacheRead: 10 },
    )
  })

  it('retains an entry whose transcript Claude Code has since pruned', () => {
    const index = emptySpendIndex()
    mergeTranscript(index, 'pruned.jsonl', indexTranscript([response()], STAT))

    mergeTranscript(index, 'fresh.jsonl', indexTranscript([response()], STAT))

    expect(index.transcripts.has('pruned.jsonl')).toBe(true)
    expect([...iterateRows(index)]).toHaveLength(2)
  })
})

describe('needsRescan', () => {
  it('reads a transcript the index has never seen', () => {
    expect(needsRescan(emptySpendIndex(), 'a.jsonl', STAT)).toBe(true)
  })

  it('skips a transcript whose size and mtime are unchanged', () => {
    const index = emptySpendIndex()
    mergeTranscript(index, 'a.jsonl', indexTranscript([response()], STAT))

    expect(needsRescan(index, 'a.jsonl', STAT)).toBe(false)
  })

  it('rereads an appended transcript', () => {
    const index = emptySpendIndex()
    mergeTranscript(index, 'a.jsonl', indexTranscript([response()], STAT))

    expect(needsRescan(index, 'a.jsonl', { sizeBytes: 200, modifiedAt: 1 })).toBe(true)
    expect(needsRescan(index, 'a.jsonl', { sizeBytes: 100, modifiedAt: 2 })).toBe(true)
  })
})

describe('iterateRows', () => {
  it('yields every row of every transcript with its directory, hour, and model', () => {
    const index = emptySpendIndex()
    mergeTranscript(index, 'a.jsonl', indexTranscript([response()], STAT))
    mergeTranscript(index, 'b.jsonl', indexTranscript([response({ cwd: '/b' })], STAT))

    expect([...iterateRows(index)].map(({ cwd, utcHour, model }) => ({ cwd, utcHour, model }))).toEqual([
      { cwd: '/Users/dev/project', utcHour: '2026-08-27T09', model: 'claude-opus-5' },
      { cwd: '/b', utcHour: '2026-08-27T09', model: 'claude-opus-5' },
    ])
  })
})
