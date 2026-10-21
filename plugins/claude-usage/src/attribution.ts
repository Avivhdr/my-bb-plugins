export interface AttributionSource {
  projects: Array<{ id: string; name: string; paths: string[] }>
  environments: Array<{ id: string; projectId: string; path: string }>
  threads: Array<{ id: string; title: string; projectId: string; environmentId: string; providerId: string }>
}

export interface ThreadAttribution {
  threadId: string
  threadTitle: string
  projectId: string
  projectName: string
}

export type ProjectAttribution =
  | { kind: 'project'; projectId: string; projectName: string }
  | { kind: 'outside' }

export interface Attribution {
  project: ProjectAttribution
  thread: ThreadAttribution | null
}

interface DirectoryEntry {
  path: string
  projectId: string
  projectName: string
  thread: ThreadAttribution | null
}

export interface AttributionMap {
  directories: readonly DirectoryEntry[]
  threadsById: ReadonlyMap<string, ThreadAttribution>
}

const CLAUDE_CODE_PROVIDER = 'claude-code'
/** BB clears a destroyed environment's path, but the git-worktree provider's folder name still names the thread. */
const WORKTREE_FOLDER =/\/worktrees\/(thr_[a-z0-9]+)-\d+(?:\/|$)/

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * A directory names a thread only when one Claude Code thread is its sole
 * user: a project source path, or an environment several threads share, cannot
 * say which of them spent the money. Longest path first, so a worktree nested
 * inside a checkout resolves through its own thread.
 */
export function buildAttributionMap(source: AttributionSource): AttributionMap {
  const projectNames = new Map(source.projects.map((project) => [project.id, project.name]))
  const nameOf = (projectId: string) => projectNames.get(projectId) ?? projectId
  const sourcePaths = new Set<string>()
  const directories: DirectoryEntry[] = []
  for (const project of source.projects) {
    for (const path of project.paths) {
      const normalized = normalizePath(path)
      sourcePaths.add(normalized)
      directories.push({ path: normalized, projectId: project.id, projectName: project.name, thread: null })
    }
  }

  const threadsByEnvironment = new Map<string, AttributionSource['threads']>()
  const threadsById = new Map<string, ThreadAttribution>()
  for (const thread of source.threads) {
    if (thread.providerId !== CLAUDE_CODE_PROVIDER) continue
    threadsByEnvironment.set(thread.environmentId, [...(threadsByEnvironment.get(thread.environmentId) ?? []), thread])
    threadsById.set(thread.id, {
      threadId: thread.id,
      threadTitle: thread.title,
      projectId: thread.projectId,
      projectName: nameOf(thread.projectId),
    })
  }

  for (const environment of source.environments) {
    const path = normalizePath(environment.path)
    if (sourcePaths.has(path)) continue
    const threads = threadsByEnvironment.get(environment.id) ?? []
    directories.push({
      path,
      projectId: environment.projectId,
      projectName: nameOf(environment.projectId),
      thread: threads.length === 1 ? threadsById.get(threads[0]!.id)! : null,
    })
  }

  directories.sort((left, right) => right.path.length - left.path.length)
  return { directories, threadsById }
}

export function attribute(map: AttributionMap, cwd: string): Attribution {
  const target = normalizePath(cwd)
  for (const entry of map.directories) {
    if (target === entry.path || target.startsWith(`${entry.path}/`)) {
      return {
        project: { kind: 'project', projectId: entry.projectId, projectName: entry.projectName },
        thread: entry.thread,
      }
    }
  }
  const named = WORKTREE_FOLDER.exec(target)
  const thread = named ? map.threadsById.get(named[1]!) : undefined
  if (thread) {
    return { project: { kind: 'project', projectId: thread.projectId, projectName: thread.projectName }, thread }
  }
  return { project: { kind: 'outside' }, thread: null }
}
