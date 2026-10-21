import { describe, expect, it } from 'vitest'
import { kvProjectStorage, type KvLike } from './projectStorage'

function memoryKv(): KvLike & { keys(): string[] } {
  const rows = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => rows.get(key) as T | undefined,
    set: async (key, value) => void rows.set(key, value),
    delete: async (key) => void rows.delete(key),
    keys: () => [...rows.keys()],
  }
}

describe('kvProjectStorage', () => {
  it('reads a missing key as null', async () => {
    const storage = kvProjectStorage(memoryKv())
    expect(await storage.project('proj_a').get('columnLabels')).toBeNull()
  })

  it('keeps each project under its own prefix', async () => {
    const kv = memoryKv()
    const storage = kvProjectStorage(kv)
    await storage.project('proj_a').set('columnLabels', ['bug'])
    await storage.project('proj_b').set('columnLabels', ['feature'])

    expect(await storage.project('proj_a').get('columnLabels')).toEqual(['bug'])
    expect(await storage.project('proj_b').get('columnLabels')).toEqual(['feature'])
    expect(kv.keys().sort()).toEqual(['project:proj_a:columnLabels', 'project:proj_b:columnLabels'])
  })

  it('deletes within the project only', async () => {
    const storage = kvProjectStorage(memoryKv())
    await storage.project('proj_a').set('repo', 'acme/a')
    await storage.project('proj_b').set('repo', 'acme/b')
    await storage.project('proj_a').delete('repo')

    expect(await storage.project('proj_a').get('repo')).toBeNull()
    expect(await storage.project('proj_b').get('repo')).toBe('acme/b')
  })
})
