import { describe, expect, it } from 'vitest'
import { loadSpendIndex, saveTranscripts } from './indexStore'
import { emptySpendIndex, indexTranscript, iterateRows, mergeTranscript } from './spendIndex'
import { migratedDatabase } from './testDatabase'
import type { BilledResponse } from './transcript'


function response(overrides: Partial<BilledResponse> = {}): BilledResponse {
  return {
    messageId: 'msg_1',
    model: 'claude-opus-5',
    timestamp: Date.parse('2026-08-27T09:15:00.000Z'),
    cwd: '/code/app',
    tokens: { input: 1, output: 2, cacheWrite5m: 3, cacheWrite1h: 4, cacheRead: 5 },
    ...overrides,
  }
}

describe('index store', () => {
  it('round-trips transcripts with their rows, sizes, and mtimes', () => {
    const db = migratedDatabase()
    const index = emptySpendIndex()
    mergeTranscript(index, 'a.jsonl', indexTranscript([response()], { sizeBytes: 10, modifiedAt: 1.5 }))
    mergeTranscript(index, 'b.jsonl', indexTranscript([response({ cwd: '/b' })], { sizeBytes: 20, modifiedAt: null }))

    saveTranscripts(db, index, ['a.jsonl', 'b.jsonl'])
    const restored = loadSpendIndex(db)

    expect([...iterateRows(restored)]).toEqual([...iterateRows(index)])
    expect(restored.transcripts.get('a.jsonl')).toMatchObject({ sizeBytes: 10, modifiedAt: 1.5 })
    expect(restored.transcripts.get('b.jsonl')).toMatchObject({ sizeBytes: 20, modifiedAt: null })
  })

  it('replaces only the rows of the transcripts it is given', () => {
    const db = migratedDatabase()
    const index = emptySpendIndex()
    mergeTranscript(index, 'a.jsonl', indexTranscript([response()], { sizeBytes: 10, modifiedAt: 1 }))
    mergeTranscript(index, 'b.jsonl', indexTranscript([response({ cwd: '/b' })], { sizeBytes: 10, modifiedAt: 1 }))
    saveTranscripts(db, index, ['a.jsonl', 'b.jsonl'])

    mergeTranscript(index, 'a.jsonl', indexTranscript([response({ cwd: '/moved' })], { sizeBytes: 11, modifiedAt: 2 }))
    saveTranscripts(db, index, ['a.jsonl'])

    const cwds = [...iterateRows(loadSpendIndex(db))].map((row) => row.cwd).sort()
    expect(cwds).toEqual(['/b', '/moved'])
  })

  it('keeps a stored transcript that is absent from the in-memory index', () => {
    const db = migratedDatabase()
    const index = emptySpendIndex()
    mergeTranscript(index, 'pruned.jsonl', indexTranscript([response()], { sizeBytes: 10, modifiedAt: 1 }))
    saveTranscripts(db, index, ['pruned.jsonl'])

    saveTranscripts(db, emptySpendIndex(), [])

    expect(loadSpendIndex(db).transcripts.has('pruned.jsonl')).toBe(true)
  })

  it('round-trips the session summary and facets', () => {
    const db = migratedDatabase()
    const index = emptySpendIndex()
    const responses = [
      response({ messageId: 'm1', tokens: { input: 0, output: 1, cacheWrite5m: 300_000, cacheWrite1h: 0, cacheRead: 0 } }),
      response({
        messageId: 'm2',
        timestamp: Date.parse('2026-08-27T09:45:00.000Z'),
        tokens: { input: 0, output: 1, cacheWrite5m: 300_000, cacheWrite1h: 0, cacheRead: 0 },
      }),
    ]
    mergeTranscript(
      index,
      'a.jsonl',
      indexTranscript(responses, { sizeBytes: 10, modifiedAt: 1 }, { title: 'Fix it', pullRequests: ['https://x/pull/1'] }),
    )

    saveTranscripts(db, index, ['a.jsonl'])
    const restored = loadSpendIndex(db).transcripts.get('a.jsonl')!

    expect(restored.session).toEqual(index.transcripts.get('a.jsonl')!.session)
    expect(restored.facets).toEqual(index.transcripts.get('a.jsonl')!.facets)
    expect([...restored.facets.keys()].some((key) => key.endsWith('recache:15to60m'))).toBe(true)
  })

  it('loads an empty index from an empty database', () => {
    expect(loadSpendIndex(migratedDatabase()).transcripts.size).toBe(0)
  })
})
