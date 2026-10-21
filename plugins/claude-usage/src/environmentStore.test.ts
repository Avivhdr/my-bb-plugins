import { describe, expect, it } from 'vitest'
import { attribute, buildAttributionMap, type AttributionSource } from './attribution'
import { withRememberedEnvironments } from './environmentStore'
import { migratedDatabase } from './testDatabase'

const THREAD = { id: 'thr_1', title: 'Fix the panel', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' }

function source(environments: AttributionSource['environments']): AttributionSource {
  return { projects: [{ id: 'P-1', name: 'frontend', paths: [] }], environments, threads: [THREAD] }
}

describe('withRememberedEnvironments', () => {
  it('keeps attributing to a thread after BB destroys its environment', () => {
    const db = migratedDatabase()
    withRememberedEnvironments(db, source([{ id: 'E-1', projectId: 'P-1', path: '/elsewhere/checkout' }]))

    const afterCleanup = withRememberedEnvironments(db, source([]))

    expect(attribute(buildAttributionMap(afterCleanup), '/elsewhere/checkout/src').thread?.threadId).toBe('thr_1')
  })

  it('takes the live path when an environment moves', () => {
    const db = migratedDatabase()
    withRememberedEnvironments(db, source([{ id: 'E-1', projectId: 'P-1', path: '/old' }]))

    const moved = withRememberedEnvironments(db, source([{ id: 'E-1', projectId: 'P-1', path: '/new' }]))

    expect(moved.environments).toEqual([{ id: 'E-1', projectId: 'P-1', path: '/new' }])
  })
})
