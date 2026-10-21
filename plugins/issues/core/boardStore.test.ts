import { describe, expect, it } from 'vitest'
import {
  clearRepoBoardState,
  computeLabelUsage,
  keepLiveThreadLinks,
  readColumnLabels,
  readRepoOverride,
  readThreadLinks,
  readValues,
  resolveColumnLabels,
  writeColumnLabels,
  writeRepoOverride,
  writeThreadLink,
  writeValue,
} from './boardStore'
import { kvProjectStorage } from './projectStorage'
import type { Issue, RepoLabel } from './types'

/** The real per-project wrapper over an in-memory kv. */
function fakeStorage() {
  const rows = new Map<string, unknown>()
  return kvProjectStorage({
    get: async <T>(key: string) => rows.get(key) as T | undefined,
    set: async (key, value) => void rows.set(key, value),
    delete: async (key) => void rows.delete(key),
  })
}

const issue = (number: number, labels: string[]): Issue => ({
  number,
  title: `Issue ${number}`,
  body: null,
  state: 'open',
  html_url: `https://github.com/acme/repo/issues/${number}`,
  labels: labels.map((name) => ({ name, color: 'ffffff' })),
})

const repoLabels: RepoLabel[] = [
  { name: 'feature', color: '00ff00' },
  { name: 'bug', color: 'ff0000' },
  { name: 'stale', color: 'cccccc' },
]

describe('computeLabelUsage', () => {
  it('marks labels carried by any open issue, preserving repo-label order', () => {
    const usage = computeLabelUsage(repoLabels, [issue(1, ['feature']), issue(2, ['feature', 'bug'])])

    expect(usage).toEqual([
      { name: 'feature', color: '00ff00', used: true },
      { name: 'bug', color: 'ff0000', used: true },
      { name: 'stale', color: 'cccccc', used: false },
    ])
  })
})

describe('values', () => {
  it('starts empty and round-trips a value', async () => {
    const storage = fakeStorage()

    expect(await readValues(storage, 'P-1')).toEqual({})

    await writeValue(storage, 'P-1', 7, 5)

    expect(await readValues(storage, 'P-1')).toEqual({ '7': 5 })
  })

  it('clears a value by dropping its entry rather than storing null', async () => {
    const storage = fakeStorage()
    await writeValue(storage, 'P-1', 7, 5)

    await writeValue(storage, 'P-1', 7, null)

    expect(await readValues(storage, 'P-1')).toEqual({})
  })

  it('rejects values outside 1..10', async () => {
    const storage = fakeStorage()

    await expect(writeValue(storage, 'P-1', 7, 0)).rejects.toThrow(/between 1 and 10/)
    await expect(writeValue(storage, 'P-1', 7, 11)).rejects.toThrow(/between 1 and 10/)
    await expect(writeValue(storage, 'P-1', 7, 1.5)).rejects.toThrow(/between 1 and 10/)
  })

  // Plugin storage holds the whole map under one key with no atomic update, so
  // overlapping writes both read the same snapshot unless they are serialized — the
  // later one would otherwise erase the earlier issue's value.
  it('does not lose an update when two writes overlap', async () => {
    const storage = fakeStorage()

    await Promise.all([
      writeValue(storage, 'P-1', 7, 5),
      writeValue(storage, 'P-1', 9, 8),
      writeValue(storage, 'P-1', 11, 2),
    ])

    expect(await readValues(storage, 'P-1')).toEqual({ '7': 5, '9': 8, '11': 2 })
  })

  it('keeps serving later writes after one of them fails', async () => {
    const storage = fakeStorage()
    const failing = writeValue(storage, 'P-1', 7, 99).catch(() => undefined)

    await Promise.all([failing, writeValue(storage, 'P-1', 9, 8)])

    expect(await readValues(storage, 'P-1')).toEqual({ '9': 8 })
  })

  it('keeps values separate per project', async () => {
    const storage = fakeStorage()

    await writeValue(storage, 'P-1', 7, 5)
    await writeValue(storage, 'P-2', 7, 9)

    expect(await readValues(storage, 'P-1')).toEqual({ '7': 5 })
    expect(await readValues(storage, 'P-2')).toEqual({ '7': 9 })
  })
})

describe('resolveColumnLabels', () => {
  it('seeds from the labels in use on first open and persists the seed', async () => {
    const storage = fakeStorage()
    const issues = [issue(1, ['feature']), issue(2, ['bug'])]

    const columns = await resolveColumnLabels(storage, 'P-1', repoLabels, issues)

    expect(columns).toEqual(['feature', 'bug'])
    expect(await readColumnLabels(storage, 'P-1')).toEqual(['feature', 'bug'])
  })

  // An empty seed must not be persisted: `[]` means "cleared on purpose" and is never
  // re-seeded, so storing it would leave a repo that has not started labelling yet
  // permanently column-less.
  it('does not persist a seed that found no labels in use', async () => {
    const storage = fakeStorage()

    expect(await resolveColumnLabels(storage, 'P-1', repoLabels, [issue(1, [])])).toEqual([])
    expect(await readColumnLabels(storage, 'P-1')).toBeNull()

    // Once issues carry labels, the next open seeds for real.
    expect(await resolveColumnLabels(storage, 'P-1', repoLabels, [issue(1, ['bug'])])).toEqual(['bug'])
  })

  it('never re-seeds a board the user deliberately cleared', async () => {
    const storage = fakeStorage()
    await writeColumnLabels(storage, 'P-1', [])

    const columns = await resolveColumnLabels(storage, 'P-1', repoLabels, [issue(1, ['feature'])])

    expect(columns).toEqual([])
  })

  it('returns the curated columns untouched once they exist', async () => {
    const storage = fakeStorage()
    await writeColumnLabels(storage, 'P-1', ['bug', 'feature'])

    const columns = await resolveColumnLabels(storage, 'P-1', repoLabels, [issue(1, ['stale'])])

    expect(columns).toEqual(['bug', 'feature'])
  })
})

describe('thread links', () => {
  it('records the thread started from each issue', async () => {
    const storage = fakeStorage()

    await Promise.all([
      writeThreadLink(storage, 'P-1', 7, { threadId: 'thr_a', title: 'Fix it' }),
      writeThreadLink(storage, 'P-1', 9, { threadId: 'thr_b', title: null }),
    ])

    expect(await readThreadLinks(storage, 'P-1')).toEqual({
      '7': { threadId: 'thr_a', title: 'Fix it' },
      '9': { threadId: 'thr_b', title: null },
    })
  })

  it('replaces an earlier link for the same issue', async () => {
    const storage = fakeStorage()
    await writeThreadLink(storage, 'P-1', 7, { threadId: 'thr_a', title: null })
    await writeThreadLink(storage, 'P-1', 7, { threadId: 'thr_b', title: null })

    expect(await readThreadLinks(storage, 'P-1')).toEqual({ '7': { threadId: 'thr_b', title: null } })
  })

  it('drops malformed stored entries', async () => {
    const storage = fakeStorage()
    await storage.project('P-1').set('issueThreads', {
      '7': { threadId: 'thr_a', title: null },
      '8': { threadId: 42 },
      nope: { threadId: 'thr_c', title: null },
    })

    expect(await readThreadLinks(storage, 'P-1')).toEqual({ '7': { threadId: 'thr_a', title: null } })
  })

  it('keeps only links whose thread is still live', () => {
    const links = {
      '7': { threadId: 'thr_live', title: null },
      '9': { threadId: 'thr_gone', title: null },
    }

    expect(keepLiveThreadLinks(links, new Set(['thr_live']))).toEqual({
      '7': { threadId: 'thr_live', title: null },
    })
  })
})

describe('clearRepoBoardState', () => {
  it('forgets values, columns, and thread links but keeps the override', async () => {
    const storage = fakeStorage()
    await writeValue(storage, 'P-1', 7, 5)
    await writeColumnLabels(storage, 'P-1', ['bug'])
    await writeThreadLink(storage, 'P-1', 7, { threadId: 'thr_a', title: null })
    await writeRepoOverride(storage, 'P-1', 'acme/widgets')
    await writeValue(storage, 'P-2', 7, 9)

    await clearRepoBoardState(storage, 'P-1')

    expect(await readValues(storage, 'P-1')).toEqual({})
    expect(await readColumnLabels(storage, 'P-1')).toBeNull()
    expect(await readThreadLinks(storage, 'P-1')).toEqual({})
    expect(await readRepoOverride(storage, 'P-1')).toBe('acme/widgets')
    expect(await readValues(storage, 'P-2')).toEqual({ '7': 9 })
  })
})

describe('repo override', () => {
  it('round-trips a trimmed override and clears it with null or blank', async () => {
    const storage = fakeStorage()
    expect(await readRepoOverride(storage, 'P-1')).toBeNull()

    await writeRepoOverride(storage, 'P-1', '  acme/widgets ')
    expect(await readRepoOverride(storage, 'P-1')).toBe('acme/widgets')

    await writeRepoOverride(storage, 'P-1', '   ')
    expect(await readRepoOverride(storage, 'P-1')).toBeNull()

    await writeRepoOverride(storage, 'P-1', 'acme/widgets')
    await writeRepoOverride(storage, 'P-1', null)
    expect(await readRepoOverride(storage, 'P-1')).toBeNull()
  })
})
