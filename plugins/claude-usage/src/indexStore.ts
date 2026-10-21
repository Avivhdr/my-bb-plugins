import type { TokenTotals } from './pricing'
import type { SqlDatabase } from './database'
import { parseRowKey, rowKey, type SpendIndex } from './spendIndex'

interface TranscriptRecord {
  path: string
  size_bytes: number
  modified_at: number | null
}

interface TokenRowRecord {
  path: string
  cwd: string
  utc_hour: string
  model: string
  input: number
  output: number
  cache_write_5m: number
  cache_write_1h: number
  cache_read: number
}

export function loadSpendIndex(db: SqlDatabase): SpendIndex {
  const index: SpendIndex = { transcripts: new Map() }
  for (const record of db.prepare('SELECT path, size_bytes, modified_at FROM transcripts').all() as TranscriptRecord[]) {
    index.transcripts.set(record.path, {
      sizeBytes: record.size_bytes,
      modifiedAt: record.modified_at,
      rows: new Map(),
    })
  }
  for (const record of db.prepare('SELECT * FROM token_rows').all() as TokenRowRecord[]) {
    const tokens: TokenTotals = {
      input: record.input,
      output: record.output,
      cacheWrite5m: record.cache_write_5m,
      cacheWrite1h: record.cache_write_1h,
      cacheRead: record.cache_read,
    }
    index.transcripts.get(record.path)?.rows.set(rowKey(record.cwd, record.utc_hour, record.model), tokens)
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
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
