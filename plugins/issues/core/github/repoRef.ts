import type { RepoRef } from '../types'

/**
 * Parse a GitHub `owner/name` out of either a repository override or a git remote URL.
 *
 * Accepts `owner/name`, `https://github.com/owner/name(.git)`,
 * `git@github.com:owner/name(.git)` and `ssh://git@github.com/owner/name(.git)`.
 * Returns `null` when the input carries no owner/name pair.
 */
export function parseOwnerName(raw: string): RepoRef | null {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (trimmed.length === 0) return null

  // Strip transport + host so only the `owner/name` path is left.
  let path: string
  if (trimmed.startsWith('git@')) {
    // git@github.com:owner/name(.git)
    const rest = trimmed.slice('git@'.length)
    const colon = rest.indexOf(':')
    path = colon === -1 ? rest : rest.slice(colon + 1)
  } else {
    const scheme = ['https://', 'http://', 'ssh://git@', 'ssh://'].find((prefix) => trimmed.startsWith(prefix))
    if (scheme) {
      // host/owner/name(.git) — drop the host segment.
      const rest = trimmed.slice(scheme.length)
      const slash = rest.indexOf('/')
      path = slash === -1 ? rest : rest.slice(slash + 1)
    } else {
      // Bare `owner/name` override.
      path = trimmed
    }
  }

  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')

  const segments = path.split('/').filter((segment) => segment.length > 0)
  if (segments.length < 2) return null

  const [owner, name] = segments
  return { owner, name }
}

/** What a project offers for finding its GitHub repository. */
export interface RepoSources {
  projectName: string
  /** The `owner/name` the user pinned for this project, if any. */
  override: string | null
  /** The remote bb detected for the project's checkout, if any. */
  gitRemoteUrl: string | null
}

/**
 * Resolve the GitHub `owner/name` for a project: the user's override first, then the
 * git remote bb recorded for the project.
 */
export function resolveRepoRef({ projectName, override, gitRemoteUrl }: RepoSources): RepoRef {
  if (override) {
    const fromOverride = parseOwnerName(override)
    if (fromOverride) return fromOverride
  }

  if (!gitRemoteUrl) {
    throw new Error(
      `No GitHub repository found for ${projectName}: its checkout has no git remote. ` +
        'Set the repository as owner/name.',
    )
  }

  const fromRemote = parseOwnerName(gitRemoteUrl)
  if (!fromRemote) {
    throw new Error(`Could not read a GitHub owner/name from the git remote '${gitRemoteUrl}'.`)
  }
  return fromRemote
}
