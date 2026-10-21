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

  it('loads an empty index from an empty database', () => {
    expect(loadSpendIndex(migratedDatabase()).transcripts.size).toBe(0)
  })
})
