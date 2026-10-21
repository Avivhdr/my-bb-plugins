// Per-project key-value storage over the plugin's single kv namespace.
//
// bb gives a plugin one flat kv store. Every key the board persists belongs to one
// project, so each is prefixed with `project:<id>:` and the store is handed out
// already scoped, the way the board's storage code expects it.

/** The subset of `bb.storage.kv` this module needs. */
export interface KvLike {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
}

/** One project's slice of the store. A missing key reads as `null`. */
export interface ScopedStore {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

export interface ProjectStorage {
  project(projectId: string): ScopedStore
}

export function kvProjectStorage(kv: KvLike): ProjectStorage {
  return {
    project(projectId) {
      const prefix = `project:${projectId}:`
      return {
        async get<T>(key: string) {
          const value = await kv.get<T>(prefix + key)
          return value === undefined ? null : value
        },
        set: (key, value) => kv.set(prefix + key, value),
        delete: (key) => kv.delete(prefix + key),
      }
    },
  }
}
