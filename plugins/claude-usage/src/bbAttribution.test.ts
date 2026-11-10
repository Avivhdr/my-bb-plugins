import { describe, expect, it, vi } from 'vitest'
import { loadAttributionSource, loadSessionOwners, type AttributionSdk, type SessionSdk } from './bbAttribution'

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

  it('lists a thread once when both pages return it, and marks hidden threads', async () => {
    const archived = thread({ id: 'thr_old', environmentId: 'E-1' })
    const source = await loadAttributionSource(
      sdk({ active: [archived, thread({ id: 'thr_helper', visibility: 'hidden' })], archived: [archived] }),
    )

    expect(source.threads.map(({ id, hidden }) => ({ id, hidden }))).toEqual([
      { id: 'thr_old', hidden: false },
      { id: 'thr_helper', hidden: true },
    ])
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

describe('loadSessionOwners', () => {
  it('maps every session a live Claude Code thread had to it, newest as current, and skips archived threads', async () => {
    const identities: Record<string, string[]> = {
      thr_bot: ['bot-now', 'bot-now', 'bot-old'],
      thr_old: ['old-session'],
    }
    const list = vi.fn(async ({ threadId }: { threadId: string }) =>
      (identities[threadId] ?? []).map((providerThreadId, seq) => ({ seq, data: { providerThreadId } })),
    )
    const sdk: SessionSdk = {
      threads: {
        list: async ({ offset = 0 } = {}) =>
          offset
            ? []
            : [
                { id: 'thr_bot', providerId: 'claude-code', archivedAt: null },
                { id: 'thr_old', providerId: 'claude-code', archivedAt: 5 },
                { id: 'thr_codex', providerId: 'codex', archivedAt: null },
              ],
        events: { list },
      },
    }

    const owners = await loadSessionOwners(sdk)

    expect([...owners.currentOf]).toEqual([['thr_bot', 'bot-now']])
    expect([...owners.ownerOf]).toEqual([
      ['bot-now', 'thr_bot'],
      ['bot-old', 'thr_bot'],
    ])
    expect(list).toHaveBeenCalledTimes(1)
  })
})

describe('loadSessionOwners paging', () => {
  it('pages back through more identity events than one request returns', async () => {
    const seqs = Array.from({ length: 150 }, (_, position) => 150 - position)
    const list = vi.fn(async ({ beforeSeq }: { beforeSeq?: string }) =>
      seqs
        .filter((seq) => beforeSeq === undefined || seq < Number(beforeSeq))
        .slice(0, 100)
        .map((seq) => ({ seq, data: { providerThreadId: seq === 1 ? 'first' : 'now' } })),
    )
    const sdk: SessionSdk = {
      threads: {
        list: async ({ offset = 0 } = {}) => (offset ? [] : [{ id: 'thr_bot', providerId: 'claude-code' }]),
        events: { list },
      },
    }

    const owners = await loadSessionOwners(sdk)

    expect(list).toHaveBeenCalledTimes(2)
    expect(owners.ownerOf.get('first')).toBe('thr_bot')
    expect(owners.currentOf.get('thr_bot')).toBe('now')
  })
})
