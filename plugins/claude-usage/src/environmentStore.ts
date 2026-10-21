import type { AttributionSource } from './attribution'
import type { SqlDatabase } from './database'

interface KnownEnvironmentRecord {
  id: string
  project_id: string
  path: string
}

export function withRememberedEnvironments(db: SqlDatabase, live: AttributionSource): AttributionSource {
  const remember = db.prepare('INSERT OR REPLACE INTO known_environments (id, project_id, path) VALUES (?, ?, ?)')
  db.exec('BEGIN')
  try {
    for (const environment of live.environments) remember.run(environment.id, environment.projectId, environment.path)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  const known = db.prepare('SELECT id, project_id, path FROM known_environments').all() as KnownEnvironmentRecord[]
  return {
    ...live,
    environments: known.map((record) => ({ id: record.id, projectId: record.project_id, path: record.path })),
  }
}
