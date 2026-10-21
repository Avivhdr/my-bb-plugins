// Board state that GitHub does not hold: the per-issue value, the curated column
// order, the threads started from issues, and an optional repository override.
// All of it is project-scoped plugin storage, so the plugin owns everything it
// persists.

import type { ProjectStorage } from './projectStorage'
import type { Issue, LabelUsage, RepoLabel } from './types'
import type { IssueThreadLink } from './board'

const VALUES_KEY = 'issueValues'
const COLUMN_LABELS_KEY = 'columnLabels'
const THREAD_LINKS_KEY = 'issueThreads'
const REPO_OVERRIDE_KEY = 'repo'

// The values and thread links are each one map under one key, and the store offers
// no atomic update, so a read-modify-write is the only shape available. Two
// overlapping calls would otherwise both read the same snapshot, with the later write
// erasing the earlier issue's entry. Serialize each project's cycle per key.
const pendingUpdates = new Map<string, Promise<unknown>>()

function serializePerProject<T>(
  projectId: string,
  key: string,
  work: () => Promise<T>,
): Promise<T> {
  const queue = `${projectId}:${key}`
  const previous = pendingUpdates.get(queue) ?? Promise.resolve()
  // Run after whatever is queued, whether it settled or failed — one caller's failure
  // must not strand every later write for that project.
  const next = previous.catch(() => undefined).then(work)
  pendingUpdates.set(
    queue,
    next.catch(() => undefined),
  )
  return next
}

/** Issue number (as a string, since JSON object keys are strings) → value 1..10. */
export type IssueValues = Record<string, number>

/**
 * For each repo label, whether at least one open issue carries it. Order follows
 * `repoLabels` so the seeded columns come out in the repo's own label order.
 */
export function computeLabelUsage(repoLabels: RepoLabel[], issues: Issue[]): LabelUsage[] {
  const used = new Set<string>()
  for (const issue of issues) {
    for (const label of issue.labels) used.add(label.name)
  }
  return repoLabels.map((label) => ({ name: label.name, color: label.color, used: used.has(label.name) }))
}

export async function readValues(storage: ProjectStorage, projectId: string): Promise<IssueValues> {
  const stored = await storage.project(projectId).get<IssueValues>(VALUES_KEY)
  return stored ?? {}
}

/**
 * Set or clear the value for one issue. Clearing deletes the entry rather than
 * storing a null, so `readValues` only ever reports issues with an active value.
 */
export async function writeValue(
  storage: ProjectStorage,
  projectId: string,
  issueNumber: number,
  value: number | null,
): Promise<void> {
  // Validate before queueing: a bad value should reject immediately rather than wait
  // behind unrelated writes to say so.
  if (value !== null && (!Number.isInteger(value) || value < 1 || value > 10)) {
    throw new Error('value must be an integer between 1 and 10, or null')
  }

  await serializePerProject(projectId, VALUES_KEY, async () => {
    const values = await readValues(storage, projectId)
    if (value === null) {
      delete values[String(issueNumber)]
    } else {
      values[String(issueNumber)] = value
    }
    await storage.project(projectId).set<IssueValues>(VALUES_KEY, values)
  })
}

/**
 * The curated column labels, or `null` when the project has never had any. The
 * distinction matters: `null` means "seed me", `[]` means the user cleared the
 * board on purpose and must not be re-seeded.
 */
export function readColumnLabels(storage: ProjectStorage, projectId: string): Promise<string[] | null> {
  return storage.project(projectId).get<string[]>(COLUMN_LABELS_KEY)
}

export async function writeColumnLabels(
  storage: ProjectStorage,
  projectId: string,
  labels: string[],
): Promise<void> {
  await storage.project(projectId).set<string[]>(COLUMN_LABELS_KEY, labels)
}

/**
 * The columns to render, seeding on first open from the labels actually in use and
 * persisting the seed so it happens exactly once.
 */
export async function resolveColumnLabels(
  storage: ProjectStorage,
  projectId: string,
  repoLabels: RepoLabel[],
  issues: Issue[],
): Promise<string[]> {
  const existing = await readColumnLabels(storage, projectId)
  if (existing !== null) return existing

  const seeded = computeLabelUsage(repoLabels, issues)
    .filter((usage) => usage.used)
    .map((usage) => usage.name)

  // Only persist a seed that found something. Storing an empty one would be
  // indistinguishable from the user having cleared the board on purpose, which is
  // never re-seeded — so a repo whose open issues carry no labels yet would be stuck
  // column-less forever once it started labelling them.
  if (seeded.length > 0) await writeColumnLabels(storage, projectId, seeded)
  return seeded
}

/** Issue number (as a string) → the bb thread started from that issue. */
export type ThreadLinks = Record<string, IssueThreadLink>

function isThreadLink(value: unknown): value is IssueThreadLink {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.threadId === 'string' &&
    (candidate.title === null || typeof candidate.title === 'string')
  )
}

/** Stored links, with any malformed entry dropped rather than trusted. */
export async function readThreadLinks(storage: ProjectStorage, projectId: string): Promise<ThreadLinks> {
  const stored = await storage.project(projectId).get<unknown>(THREAD_LINKS_KEY)
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {}
  const links: ThreadLinks = {}
  for (const [issueNumber, link] of Object.entries(stored)) {
    const issue = Number(issueNumber)
    if (Number.isInteger(issue) && issue > 0 && isThreadLink(link)) {
      links[issueNumber] = { threadId: link.threadId, title: link.title }
    }
  }
  return links
}

/** Record the thread started from an issue, replacing any earlier one. */
export async function writeThreadLink(
  storage: ProjectStorage,
  projectId: string,
  issueNumber: number,
  link: IssueThreadLink,
): Promise<void> {
  await serializePerProject(projectId, THREAD_LINKS_KEY, async () => {
    const links = await readThreadLinks(storage, projectId)
    links[String(issueNumber)] = link
    await storage.project(projectId).set<ThreadLinks>(THREAD_LINKS_KEY, links)
  })
}

/**
 * Archiving or deleting a thread removes it from every bb surface, but the link
 * outlives it in storage. Keep only links whose thread is still live, so the board
 * never offers to open a thread that is gone.
 */
export function keepLiveThreadLinks(links: ThreadLinks, liveThreadIds: ReadonlySet<string>): ThreadLinks {
  const kept: ThreadLinks = {}
  for (const [issueNumber, link] of Object.entries(links)) {
    if (liveThreadIds.has(link.threadId)) kept[issueNumber] = link
  }
  return kept
}

/** The `owner/name` the user pinned for this project, or null to use the git remote. */
export async function readRepoOverride(storage: ProjectStorage, projectId: string): Promise<string | null> {
  const stored = await storage.project(projectId).get<unknown>(REPO_OVERRIDE_KEY)
  return typeof stored === 'string' && stored.trim().length > 0 ? stored.trim() : null
}

/**
 * Forget everything keyed to the current repository: values and thread links are
 * keyed by issue number, and columns by label name, so none of them carry over to a
 * different repository. The override itself is left alone.
 */
export async function clearRepoBoardState(storage: ProjectStorage, projectId: string): Promise<void> {
  const scope = storage.project(projectId)
  await Promise.all([
    serializePerProject(projectId, VALUES_KEY, () => scope.delete(VALUES_KEY)),
    serializePerProject(projectId, THREAD_LINKS_KEY, () => scope.delete(THREAD_LINKS_KEY)),
    scope.delete(COLUMN_LABELS_KEY),
  ])
}

/** Pin a repository for this project, or clear the pin with null. */
export async function writeRepoOverride(
  storage: ProjectStorage,
  projectId: string,
  repo: string | null,
): Promise<void> {
  const trimmed = repo?.trim() ?? ''
  if (trimmed) await storage.project(projectId).set(REPO_OVERRIDE_KEY, trimmed)
  else await storage.project(projectId).delete(REPO_OVERRIDE_KEY)
}
