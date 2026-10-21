import { describe, expect, it, vi } from 'vitest'
import { loadAttributionSource, type AttributionSdk } from './bbAttribution'

type ThreadRow = Awaited<ReturnType<AttributionSdk['threads']['list']>>[number]

function thread(overrides: Partial<ThreadRow>): ThreadRow {
  return {
    id: 'thr_1',
    title: 'Fix the panel',
    titleFallback: null,
    projectId: 'P-1',
    environmentId: 'E-1',
    providerId: 'claude-code',
    ...overrides,
  }
}

function pages<T>(items: T[]) {
  return async ({ limit = Infinity, offset = 0 }: { limit?: number; offset?: number } = {}) =>
    items.slice(offset, offset + limit)
}

function sdk(overrides: { active?: ThreadRow[]; archived?: ThreadRow[]; environments?: number } = {}): AttributionSdk {
  const environments = Array.from({ length: overrides.environments ?? 1 }, (_, position) => ({
    id: `E-${position + 1}`,
    projectId: 'P-1',
    path: `/worktrees/thr_${position + 1}` as string | null,
  }))
  return {
    projects: {
      list: async () => [
        {
          id: 'P-1',
          name: 'frontend',
          sources: [{ type: 'local_path', path: '/code/frontend' }],
        },
      ],
    },
    environments: { list: vi.fn(pages(environments)) },
    threads: {
      list: async (args = {}) => pages(args.archived ? (overrides.archived ?? []) : (overrides.active ?? []))(args),
    },
  }
}

describe('loadAttributionSource', () => {
  it('maps projects to their local source paths', async () => {
    const source = await loadAttributionSource(sdk())

    expect(source.projects).toEqual([{ id: 'P-1', name: 'frontend', paths: ['/code/frontend'] }])
  })

  it('includes the Personal project, so its threads show its name', async () => {
    const base = sdk()
    const list = vi.fn(base.projects.list)
    base.projects.list = list

    await loadAttributionSource(base)

    expect(list).toHaveBeenCalledWith({ includePersonal: true })
  })

  it('includes archived threads, so their spend keeps its thread', async () => {
    const source = await loadAttributionSource(
      sdk({ active: [thread({ id: 'thr_live' })], archived: [thread({ id: 'thr_old', environmentId: 'E-2' })] }),
    )

    expect(source.threads.map((entry) => entry.id)).toEqual(['thr_live', 'thr_old'])
  })

  it('reads every page of environments', async () => {
    const source = await loadAttributionSource(sdk({ environments: 1201 }))

    expect(source.environments).toHaveLength(1201)
  })

  it('skips environments without a path and threads without an environment', async () => {
    const base = sdk({ active: [thread({ environmentId: null })] })
    base.environments.list = async () => [{ id: 'E-1', projectId: 'P-1', path: null }]

    const source = await loadAttributionSource(base)

    expect(source.environments).toEqual([])
    expect(source.threads).toEqual([])
  })

  it('names an untitled thread by its fallback title', async () => {
    const source = await loadAttributionSource(sdk({ active: [thread({ title: null, titleFallback: 'Draft prompt' })] }))

    expect(source.threads[0]!.title).toBe('Draft prompt')
  })
})
