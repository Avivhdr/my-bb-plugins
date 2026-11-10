import type { TokenTotals } from './pricing'
import type { SqlDatabase } from './database'
import { facetKey, parseFacetKey, type CacheTtl, type Facet } from './sessionAnalysis'
import { parseRowKey, rowKey, type SpendIndex } from './spendIndex'

interface TranscriptRecord {
  path: string
  size_bytes: number
  modified_at: number | null
}

interface TokenColumns {
  input: number
  output: number
  cache_write_5m: number
  cache_write_1h: number
  cache_read: number
}

interface TokenRowRecord extends TokenColumns {
  path: string
  cwd: string
  utc_hour: string
  model: string
}

interface FacetRowRecord extends TokenColumns {
  path: string
  utc_hour: string
  model: string
  facet: string
  calls: number
}

interface SessionRecord {
  path: string
  title: string | null
  cwd: string | null
  model: string | null
  first_at: number | null
  last_at: number | null
  calls: number
  peak_context: number
  last_context: number
  cache_ttl: string
  pull_requests: string
}

function tokensOf(record: TokenColumns): TokenTotals {
  return {
    input: record.input,
    output: record.output,
    cacheWrite5m: record.cache_write_5m,
    cacheWrite1h: record.cache_write_1h,
    cacheRead: record.cache_read,
  }
}

function parsePullRequests(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : []
  } catch {
    return []
  }
}

export function loadSpendIndex(db: SqlDatabase): SpendIndex {
  const index: SpendIndex = { transcripts: new Map() }
  for (const record of db.prepare('SELECT path, size_bytes, modified_at FROM transcripts').all() as TranscriptRecord[]) {
    index.transcripts.set(record.path, {
      sizeBytes: record.size_bytes,
      modifiedAt: record.modified_at,
      rows: new Map(),
      session: null,
      facets: new Map(),
    })
  }
  for (const record of db.prepare('SELECT * FROM token_rows').all() as TokenRowRecord[]) {
    index.transcripts.get(record.path)?.rows.set(rowKey(record.cwd, record.utc_hour, record.model), tokensOf(record))
  }
  for (const record of db.prepare('SELECT * FROM sessions').all() as SessionRecord[]) {
    const transcript = index.transcripts.get(record.path)
    if (!transcript) continue
    transcript.session = {
      title: record.title,
      cwd: record.cwd,
      model: record.model,
      firstAt: record.first_at,
      lastAt: record.last_at,
      calls: record.calls,
      peakContext: record.peak_context,
      lastContext: record.last_context,
      cacheTtl: (record.cache_ttl === '1h' ? '1h' : '5m') satisfies CacheTtl,
      pullRequests: parsePullRequests(record.pull_requests),
    }
  }
  for (const record of db.prepare('SELECT * FROM facet_rows').all() as FacetRowRecord[]) {
    index.transcripts
      .get(record.path)
      ?.facets.set(facetKey(record.utc_hour, record.model, record.facet as Facet), {
        calls: record.calls,
        tokens: tokensOf(record),
      })
  }
  return index
}

export function saveTranscripts(db: SqlDatabase, index: SpendIndex, paths: Iterable<string>): void {
  const upsertTranscript = db.prepare(
    'INSERT OR REPLACE INTO transcripts (path, size_bytes, modified_at) VALUES (?, ?, ?)',
  )
  const deleteRows = db.prepare('DELETE FROM token_rows WHERE path = ?')
  const insertRow = db.prepare(
    `INSERT INTO token_rows
      (path, cwd, utc_hour, model, input, output, cache_write_5m, cache_write_1h, cache_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const upsertSession = db.prepare(
    `INSERT OR REPLACE INTO sessions
      (path, title, cwd, model, first_at, last_at, calls, peak_context, last_context, cache_ttl, pull_requests)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const deleteFacets = db.prepare('DELETE FROM facet_rows WHERE path = ?')
  const insertFacet = db.prepare(
    `INSERT INTO facet_rows
      (path, utc_hour, model, facet, calls, input, output, cache_write_5m, cache_write_1h, cache_read)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  db.exec('BEGIN')
  try {
    for (const path of paths) {
      const transcript = index.transcripts.get(path)
      if (!transcript) continue
      upsertTranscript.run(path, transcript.sizeBytes, transcript.modifiedAt)
      deleteRows.run(path)
      for (const [key, t] of transcript.rows) {
        const parsed = parseRowKey(key)
        if (!parsed) continue
        insertRow.run(path, parsed.cwd, parsed.utcHour, parsed.model, t.input, t.output, t.cacheWrite5m, t.cacheWrite1h, t.cacheRead)
      }
      const session = transcript.session
      if (session) {
        upsertSession.run(
          path,
          session.title,
          session.cwd,
          session.model,
          session.firstAt,
          session.lastAt,
          session.calls,
          session.peakContext,
          session.lastContext,
          session.cacheTtl,
          JSON.stringify(session.pullRequests),
        )
      }
      deleteFacets.run(path)
      for (const [key, { calls, tokens: t }] of transcript.facets) {
        const parsed = parseFacetKey(key)
        if (!parsed) continue
        insertFacet.run(path, parsed.utcHour, parsed.model, parsed.facet, calls, t.input, t.output, t.cacheWrite5m, t.cacheWrite1h, t.cacheRead)
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
