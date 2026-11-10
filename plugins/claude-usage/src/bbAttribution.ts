import type { AttributionSource } from './attribution'

const PAGE_SIZE = 500

interface PageArgs {
  limit?: number
  offset?: number
}

export interface AttributionSdk {
  projects: {
    list(args?: { includePersonal?: boolean }): Promise<
      Array<{ id: string; name: string; sources: Array<{ type: string; path: string }> }>
    >
  }
  environments: {
    list(args?: PageArgs): Promise<Array<{ id: string; projectId: string; path: string | null }>>
  }
  threads: {
    list(args?: PageArgs & { archived?: boolean; includeHidden?: boolean }): Promise<
      Array<{
        id: string
        title: string | null
        titleFallback: string | null
        projectId: string
        environmentId: string | null
        providerId: string
        visibility?: string | null
      }>
    >
  }
}

async function readAllPages<T>(list: (args: PageArgs) => Promise<T[]>): Promise<T[]> {
  const all: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await list({ limit: PAGE_SIZE, offset })
    all.push(...page)
    if (page.length < PAGE_SIZE) return all
  }
}

function threadTitle(title: string | null, fallback: string | null): string {
  const firstLine = (title ?? fallback ?? '').split('\n', 1)[0]!.trim()
  if (firstLine.length === 0) return 'Untitled thread'
  return firstLine.length > 80 ? `${firstLine.slice(0, 79)}…` : firstLine
}

export async function loadAttributionSource(sdk: AttributionSdk): Promise<AttributionSource> {
  const [projects, environments, active, archived] = await Promise.all([
    sdk.projects.list({ includePersonal: true }),
    readAllPages((page) => sdk.environments.list(page)),
    readAllPages((page) => sdk.threads.list({ ...page, includeHidden: true })),
    readAllPages((page) => sdk.threads.list({ ...page, includeHidden: true, archived: true })),
  ])
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      paths: project.sources.filter((source) => source.type === 'local_path').map((source) => source.path),
    })),
    environments: environments.flatMap((environment) =>
      environment.path === null ? [] : [{ id: environment.id, projectId: environment.projectId, path: environment.path }],
    ),
    // The default list already includes archived threads, so the archived page
    // repeats them. Counted twice, a thread looks like two sharing its environment.
    threads: [...new Map([...active, ...archived].map((thread) => [thread.id, thread])).values()].flatMap((thread) =>
      thread.environmentId === null
        ? []
        : [
            {
              id: thread.id,
              title: threadTitle(thread.title, thread.titleFallback),
              projectId: thread.projectId,
              environmentId: thread.environmentId,
              providerId: thread.providerId,
              hidden: thread.visibility === 'hidden',
            },
          ],
    ),
  }
}

/** Which Claude Code session each thread is on now, and which thread every known session belongs to. */
export interface SessionOwners {
  ownerOf: Map<string, string>
  currentOf: Map<string, string>
}

export interface SessionSdk {
  threads: {
    list(args?: PageArgs & { includeHidden?: boolean }): Promise<
      Array<{ id: string; providerId: string; archivedAt?: number | null }>
    >
    events: {
      list(args: {
        threadId: string
        types: readonly ['thread/identity']
        order: 'desc'
        limit: string
        beforeSeq?: string
      }): Promise<Array<{ seq: number; data: unknown }>>
    }
  }
}

/** bb's cap on one page of thread events. */
const EVENT_PAGE = 100
/** A thread changes sessions on every clear or compaction; this many pages covers months of them. */
const MAX_EVENT_PAGES = 10

async function identityEvents(sdk: SessionSdk, threadId: string): Promise<Array<{ data: unknown }>> {
  const all: Array<{ seq: number; data: unknown }> = []
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const rows = await sdk.threads.events.list({
      threadId,
      types: ['thread/identity'],
      order: 'desc',
      limit: String(EVENT_PAGE),
      ...(all.length > 0 ? { beforeSeq: String(all.at(-1)!.seq) } : {}),
    })
    all.push(...rows)
    if (rows.length < EVENT_PAGE) break
  }
  return all
}

/**
 * bb records a `thread/identity` event naming the provider session each time
 * a thread's runtime attaches. That is the only reliable link from a thread to
 * its transcript when several threads, hidden helpers included, share one
 * worktree. Archived threads are skipped: nobody sends their next message.
 */
export async function loadSessionOwners(sdk: SessionSdk): Promise<SessionOwners> {
  const threads = (await readAllPages((page) => sdk.threads.list({ ...page, includeHidden: true }))).filter(
    (thread) => thread.providerId === 'claude-code' && !thread.archivedAt,
  )
  const owners: SessionOwners = { ownerOf: new Map(), currentOf: new Map() }
  const histories = await Promise.all(
    threads.map(async (thread) => ({
      threadId: thread.id,
      events: await identityEvents(sdk, thread.id),
    })),
  )
  for (const { threadId, events } of histories) {
    for (const event of events) {
      const sessionId = (event.data as { providerThreadId?: unknown } | null)?.providerThreadId
      if (typeof sessionId !== 'string' || sessionId.length === 0) continue
      if (!owners.currentOf.has(threadId)) owners.currentOf.set(threadId, sessionId)
      owners.ownerOf.set(sessionId, threadId)
    }
  }
  return owners
}
