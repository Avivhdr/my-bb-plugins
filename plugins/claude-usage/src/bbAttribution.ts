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
    threads: [...active, ...archived].flatMap((thread) =>
      thread.environmentId === null
        ? []
        : [
            {
              id: thread.id,
              title: threadTitle(thread.title, thread.titleFallback),
              projectId: thread.projectId,
              environmentId: thread.environmentId,
              providerId: thread.providerId,
            },
          ],
    ),
  }
}
