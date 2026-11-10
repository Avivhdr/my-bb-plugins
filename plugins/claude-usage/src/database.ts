/** The subset of better-sqlite3 that node:sqlite also implements, so tests need no native build. */
export interface SqlDatabase {
  exec(sql: string): unknown
  prepare(sql: string): {
    run(...params: unknown[]): unknown
    all(...params: unknown[]): unknown[]
  }
}

/** Append-only: `bb.storage.migrate` keys each statement by its position. */
export const MIGRATIONS = [
  `CREATE TABLE transcripts (
    path TEXT PRIMARY KEY,
    size_bytes INTEGER NOT NULL,
    modified_at REAL
  )`,
  `CREATE TABLE token_rows (
    path TEXT NOT NULL,
    cwd TEXT NOT NULL,
    utc_hour TEXT NOT NULL,
    model TEXT NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_write_5m INTEGER NOT NULL,
    cache_write_1h INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    PRIMARY KEY (path, cwd, utc_hour, model)
  )`,
  `CREATE TABLE known_environments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    path TEXT NOT NULL
  )`,
  `CREATE TABLE sessions (
    path TEXT PRIMARY KEY,
    title TEXT,
    cwd TEXT,
    model TEXT,
    first_at REAL,
    last_at REAL,
    calls INTEGER NOT NULL,
    peak_context INTEGER NOT NULL,
    last_context INTEGER NOT NULL,
    cache_ttl TEXT NOT NULL,
    pull_requests TEXT NOT NULL
  )`,
  `CREATE TABLE facet_rows (
    path TEXT NOT NULL,
    utc_hour TEXT NOT NULL,
    model TEXT NOT NULL,
    facet TEXT NOT NULL,
    calls INTEGER NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_write_5m INTEGER NOT NULL,
    cache_write_1h INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    PRIMARY KEY (path, utc_hour, model, facet)
  )`,
]
