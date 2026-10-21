import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './database'

export function migratedDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  for (const statement of MIGRATIONS) db.exec(statement)
  return db
}
