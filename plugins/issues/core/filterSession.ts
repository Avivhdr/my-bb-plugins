// Filter selections for the current page session.
// The map lives in this module, so it survives leaving the Issues panel and is
// gone when the bb window reloads. It is not plugin storage.

import type { DependencyMode } from './dependency'
import type { ThreadAssociationMode } from './threadAssociation'

/** One chosen value chip. `'none'` is the "No value" chip. */
export type IssuesFilterValue = number | 'none'

/** The thread, dependency, and value selections for one project. */
export interface IssuesFilterSelection {
  threadMode: ThreadAssociationMode
  dependencyMode: DependencyMode
  values: IssuesFilterValue[]
}

const selections = new Map<string, IssuesFilterSelection>()

function emptySelection(): IssuesFilterSelection {
  return { threadMode: 'all', dependencyMode: 'all', values: [] }
}

/** The selection stored for `projectId`, or the default when nothing is stored. */
export function readIssuesFilterSelection(projectId: string | null): IssuesFilterSelection {
  const stored = projectId ? selections.get(projectId) : undefined
  if (!stored) return emptySelection()
  return {
    threadMode: stored.threadMode,
    dependencyMode: stored.dependencyMode,
    values: [...stored.values],
  }
}

/**
 * Merge `patch` into the selection for `projectId`. A missing project id is
 * ignored. Each field is replaced only when the patch carries that field, so
 * the thread, dependency, and value controls can save independently.
 */
export function updateIssuesFilterSelection(
  projectId: string | null,
  patch: Partial<IssuesFilterSelection>,
): void {
  if (!projectId) return
  const current = readIssuesFilterSelection(projectId)
  selections.set(projectId, {
    threadMode: patch.threadMode ?? current.threadMode,
    dependencyMode: patch.dependencyMode ?? current.dependencyMode,
    values: patch.values !== undefined ? [...patch.values] : [...current.values],
  })
}

/** Drop every stored selection. Tests use this between cases. */
export function clearIssuesFilterSession(): void {
  selections.clear()
}
