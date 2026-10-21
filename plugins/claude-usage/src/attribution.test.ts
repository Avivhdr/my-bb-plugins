import { describe, expect, it } from 'vitest'
import { attribute, buildAttributionMap } from './attribution'

const WORKTREES = '/Users/dev/.bb/worktrees'

const map = buildAttributionMap({
  projects: [
    { id: 'P-1', name: 'frontend', paths: ['/Users/dev/code/frontend'] },
    { id: 'P-2', name: 'backend', paths: ['/Users/dev/code/backend/'] },
  ],
  environments: [
    { id: 'E-worktree', projectId: 'P-1', path: `${WORKTREES}/thr_a-1/frontend` },
    { id: 'E-nested', projectId: 'P-1', path: '/Users/dev/code/frontend/.worktrees/thr_b' },
    { id: 'E-shared', projectId: 'P-1', path: `${WORKTREES}/thr_c-1/frontend` },
    { id: 'E-local', projectId: 'P-2', path: '/Users/dev/code/backend' },
    { id: 'E-codex', projectId: 'P-2', path: `${WORKTREES}/thr_e-1/backend` },
  ],
  threads: [
    { id: 'thr_a', title: 'Fix the flashing panel', projectId: 'P-1', environmentId: 'E-worktree', providerId: 'claude-code' },
    { id: 'thr_b', title: 'Nested in the checkout', projectId: 'P-1', environmentId: 'E-nested', providerId: 'claude-code' },
    { id: 'thr_c', title: 'First in shared', projectId: 'P-1', environmentId: 'E-shared', providerId: 'claude-code' },
    { id: 'thr_c2', title: 'Second in shared', projectId: 'P-1', environmentId: 'E-shared', providerId: 'claude-code' },
    { id: 'thr_d', title: 'Runs in place', projectId: 'P-2', environmentId: 'E-local', providerId: 'claude-code' },
    { id: 'thr_e', title: 'Codex thread', projectId: 'P-2', environmentId: 'E-codex', providerId: 'codex' },
  ],
})

const FRONTEND = { kind: 'project', projectId: 'P-1', projectName: 'frontend' }
const BACKEND = { kind: 'project', projectId: 'P-2', projectName: 'backend' }

describe('attribute', () => {
  it('names the thread that is alone in its worktree, and that worktree’s project', () => {
    expect(attribute(map, `${WORKTREES}/thr_a-1/frontend`)).toEqual({
      project: FRONTEND,
      thread: { threadId: 'thr_a', threadTitle: 'Fix the flashing panel', projectId: 'P-1', projectName: 'frontend' },
    })
  })

  it('attributes a directory deeper inside a worktree, since agents record nested paths', () => {
    expect(attribute(map, `${WORKTREES}/thr_a-1/frontend/src/app`).thread?.threadId).toBe('thr_a')
  })

  it('resolves a worktree nested inside a checkout through its own thread', () => {
    expect(attribute(map, '/Users/dev/code/frontend/.worktrees/thr_b/src').thread?.threadId).toBe('thr_b')
  })

  it('counts an environment shared by two threads for the project only', () => {
    expect(attribute(map, `${WORKTREES}/thr_c-1/frontend`)).toEqual({ project: FRONTEND, thread: null })
  })

  it('counts a project source directory for the project only, even with one thread running in it', () => {
    expect(attribute(map, '/Users/dev/code/backend/api')).toEqual({ project: BACKEND, thread: null })
  })

  it('does not name a thread of another provider', () => {
    expect(attribute(map, `${WORKTREES}/thr_e-1/backend`)).toEqual({ project: BACKEND, thread: null })
  })

  it('reports a directory outside every project and environment as outside BB', () => {
    expect(attribute(map, '/Users/dev/scratch')).toEqual({ project: { kind: 'outside' }, thread: null })
  })

  it('does not match a sibling directory that only shares a name prefix', () => {
    expect(attribute(map, '/Users/dev/code/frontend-old').project).toEqual({ kind: 'outside' })
  })
})

describe('attribute for a destroyed worktree', () => {
  const withArchived = buildAttributionMap({
    projects: [{ id: 'P-1', name: 'frontend', paths: ['/Users/dev/code/frontend'] }],
    environments: [{ id: 'E-live', projectId: 'P-1', path: `${WORKTREES}/thr_live-1/frontend` }],
    threads: [
      { id: 'thr_gone', title: 'Archived work', projectId: 'P-1', environmentId: 'E-destroyed', providerId: 'claude-code' },
      { id: 'thr_live', title: 'Live work', projectId: 'P-1', environmentId: 'E-live', providerId: 'claude-code' },
      { id: 'thr_codex', title: 'Codex work', projectId: 'P-1', environmentId: 'E-x', providerId: 'codex' },
    ],
  })

  it('reads the thread from the worktree folder name when no path matches', () => {
    expect(attribute(withArchived, `${WORKTREES}/thr_gone-1/frontend/src`)).toEqual({
      project: FRONTEND,
      thread: { threadId: 'thr_gone', threadTitle: 'Archived work', projectId: 'P-1', projectName: 'frontend' },
    })
  })

  it('reports a worktree folder naming a thread BB does not know as outside BB', () => {
    expect(attribute(withArchived, `${WORKTREES}/thr_unknown-1/frontend`)).toEqual({
      project: { kind: 'outside' },
      thread: null,
    })
  })

  it('does not read a thread of another provider from a folder name', () => {
    expect(attribute(withArchived, `${WORKTREES}/thr_codex-1/frontend`).thread).toBeNull()
  })

  it('prefers a known path over the folder name', () => {
    const shared = buildAttributionMap({
      projects: [],
      environments: [{ id: 'E-1', projectId: 'P-1', path: `${WORKTREES}/thr_gone-1/frontend` }],
      threads: [
        { id: 'thr_gone', title: 'A', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' },
        { id: 'thr_fork', title: 'B', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' },
      ],
    })

    expect(attribute(shared, `${WORKTREES}/thr_gone-1/frontend`).thread).toBeNull()
  })
})
