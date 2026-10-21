import { describe, expect, it, vi } from 'vitest'
import type { AttributionSource } from './attribution'
import { fakeFileSystem, usageLine } from './fakeFileSystem'
import { createSpendService, type SpendServiceDependencies } from './spendService'
import { migratedDatabase } from './testDatabase'

const NOW = Date.parse('2026-08-27T12:00:00.000Z')

const SOURCE: AttributionSource = {
  projects: [{ id: 'P-1', name: 'frontend', paths: ['/code/frontend'] }],
  environments: [{ id: 'E-1', projectId: 'P-1', path: '/worktrees/thr_1' }],
  threads: [{ id: 'thr_1', title: 'Fix the panel', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' }],
}


function dependencies(overrides: Partial<SpendServiceDependencies> = {}): SpendServiceDependencies {
  return {
    db: migratedDatabase(),
    fs: fakeFileSystem({
      proj: null,
      'proj/a.jsonl': usageLine({ cwd: '/worktrees/thr_1', at: '2026-08-27T09:00:00.000Z' }),
    }),
    root: '/home/dev/.claude/projects',
    loadAttributionSource: async () => SOURCE,
    now: () => NOW,
    ...overrides,
  }
}

describe('createSpendService', () => {
  it('persists what a scan read, so a reloaded service starts from it', async () => {
    const shared = dependencies()
    await createSpendService(shared).refresh()

    const reloaded = createSpendService({ ...shared, fs: fakeFileSystem({}) })

    expect((await reloaded.getDashboard()).transcriptCount).toBe(1)
  })

  it('persists nothing from an aborted scan, and reads those transcripts again next time', async () => {
    const shared = dependencies()
    const service = createSpendService(shared)
    const controller = new AbortController()
    controller.abort()

    await expect(service.refresh(controller.signal)).rejects.toThrow()

    expect((await createSpendService(shared).getDashboard()).transcriptCount).toBe(0)
    expect((await service.refresh()).readPaths).toEqual(['proj/a.jsonl'])
  })

  it('reports indexing until the first scan completes on an empty index', async () => {
    const service = createSpendService(dependencies())

    expect((await service.getDashboard()).indexing).toBe(true)
    await service.refresh()
    expect((await service.getDashboard()).indexing).toBe(false)
  })

  it('does not report indexing when stored history already exists', async () => {
    const shared = dependencies()
    await createSpendService(shared).refresh()

    expect((await createSpendService(shared).getDashboard()).indexing).toBe(false)
  })

  it('attributes spend to the thread alone in its environment, on the dashboard and for the thread', async () => {
    const service = createSpendService(dependencies())
    await service.refresh()

    const dashboard = await service.getDashboard()
    const thread = await service.getThreadSpend('thr_1')

    expect(dashboard.byThread.map((entry) => entry.key)).toEqual(['thread:thr_1'])
    expect(thread).toEqual({ threadId: 'thr_1', found: true, total: dashboard.byThread[0]!.total })
  })

  it('reuses the attribution source for a short while instead of reloading it on every read', async () => {
    let now = NOW
    const loadAttributionSource = vi.fn(async () => SOURCE)
    const service = createSpendService(dependencies({ loadAttributionSource, now: () => now }))

    await service.getDashboard()
    await service.getThreadSpend('thr_1')
    expect(loadAttributionSource).toHaveBeenCalledTimes(1)

    now += 60_000
    await service.getDashboard()
    expect(loadAttributionSource).toHaveBeenCalledTimes(2)
  })

  it('keeps totals when attribution cannot be loaded, and reports the failure', async () => {
    const onError = vi.fn()
    const service = createSpendService(
      dependencies({
        loadAttributionSource: async () => {
          throw new Error('sdk down')
        },
        onError,
      }),
    )
    await service.refresh()

    const dashboard = await service.getDashboard()

    expect(dashboard.totals.allTime.total).toBeGreaterThan(0)
    expect(dashboard.outside.total).toBe(dashboard.totals.allTime.total)
    expect(onError).toHaveBeenCalledWith('failed to resolve spend attribution', expect.any(Error))
  })

  it('runs overlapping refreshes one after the other', async () => {
    const service = createSpendService(dependencies())

    const [first, second] = await Promise.all([service.refresh(), service.refresh()])

    expect(first.readPaths).toEqual(['proj/a.jsonl'])
    expect(second.readPaths).toEqual([])
  })
})
