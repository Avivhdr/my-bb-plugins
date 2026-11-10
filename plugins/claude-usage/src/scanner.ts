import { homedir } from 'node:os'
import { join } from 'node:path'
import { indexTranscript, mergeTranscript, needsRescan, type SpendIndex, type TranscriptMeta } from './spendIndex'
import {
  collapseToBilledResponses,
  isBillable,
  LineAssembler,
  parseTranscriptEntry,
  type BilledResponse,
} from './transcript'

export interface TranscriptDirectoryEntry {
  name: string
  path: string
  isDir: boolean
  size: number | null
  modifiedAt: number | null
}

export interface TranscriptFileSystem {
  readDir(request: { root: string; path?: string | null }): Promise<TranscriptDirectoryEntry[]>
  readTextFileChunks(request: {
    root: string
    path: string
    chunkSizeBytes?: number
    signal?: AbortSignal
  }): AsyncIterable<string>
  /** The last `bytes` of a file, or all of it when shorter. May start mid-line. */
  readTextTail(request: { root: string; path: string; bytes: number }): Promise<string>
}

export interface TranscriptStat {
  path: string
  sizeBytes: number
  modifiedAt: number | null
}

export interface ScanResult {
  transcriptsSeen: number
  readPaths: string[]
  transcriptsFailed: number
  responsesIndexed: number
}

const MAX_DEPTH = 4
const CHUNK_SIZE_BYTES = 256 * 1024

export function resolveTranscriptRoot(env: Record<string, string | undefined> = process.env): string {
  const configDir = env.CLAUDE_CONFIG_DIR?.trim()
  return join(configDir && configDir.length > 0 ? configDir : join(homedir(), '.claude'), 'projects')
}

/**
 * `readDir` returns paths relative to the root, so nested children are reached
 * by passing the parent's own relative path back in.
 */
export async function listTranscripts(
  fs: TranscriptFileSystem,
  root: string,
  signal?: AbortSignal,
): Promise<TranscriptStat[]> {
  const found: TranscriptStat[] = []
  const queue: Array<{ path: string | null; depth: number }> = [{ path: null, depth: 0 }]
  while (queue.length > 0) {
    signal?.throwIfAborted()
    const { path, depth } = queue.shift()!
    let entries: TranscriptDirectoryEntry[]
    try {
      entries = await fs.readDir({ root, path })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.isDir) {
        if (depth < MAX_DEPTH) queue.push({ path: entry.path, depth: depth + 1 })
      } else if (entry.name.endsWith('.jsonl')) {
        found.push({ path: entry.path, sizeBytes: entry.size ?? 0, modifiedAt: entry.modifiedAt })
      }
    }
  }
  return found
}

interface TranscriptContents {
  responses: BilledResponse[]
  meta: TranscriptMeta & { pullRequests: string[] }
}

async function readTranscript(
  fs: TranscriptFileSystem,
  root: string,
  path: string,
  signal?: AbortSignal,
): Promise<TranscriptContents> {
  const assembler = new LineAssembler()
  const byMessageId = new Map<string, BilledResponse>()
  const meta: TranscriptContents['meta'] = { title: null, pullRequests: [] }
  const absorb = (lines: string[]) => {
    for (const line of lines) {
      const entry = parseTranscriptEntry(line)
      if (!entry) continue
      if (entry.kind === 'title') meta.title = entry.title
      else if (entry.kind === 'pullRequest') meta.pullRequests.push(entry.url)
      else if (isBillable(entry.response)) byMessageId.set(entry.response.messageId, entry.response)
    }
  }
  for await (const chunk of fs.readTextFileChunks({
    root,
    path,
    chunkSizeBytes: CHUNK_SIZE_BYTES,
    signal,
  })) {
    absorb(assembler.push(chunk))
  }
  absorb(assembler.flush())
  return { responses: collapseToBilledResponses(byMessageId.values()), meta }
}

export async function scanTranscripts(request: {
  fs: TranscriptFileSystem
  root: string
  index: SpendIndex
  signal?: AbortSignal
}): Promise<ScanResult> {
  const { fs, root, index, signal } = request
  const result: ScanResult = {
    transcriptsSeen: 0,
    readPaths: [],
    transcriptsFailed: 0,
    responsesIndexed: 0,
  }
  const transcripts = await listTranscripts(fs, root, signal)
  result.transcriptsSeen = transcripts.length
  for (const stat of transcripts) {
    signal?.throwIfAborted()
    if (!needsRescan(index, stat.path, stat)) continue
    let contents: TranscriptContents
    try {
      contents = await readTranscript(fs, root, stat.path, signal)
    } catch (error) {
      if (signal?.aborted) throw error
      result.transcriptsFailed += 1
      continue
    }
    mergeTranscript(index, stat.path, indexTranscript(contents.responses, stat, contents.meta))
    result.readPaths.push(stat.path)
    result.responsesIndexed += contents.responses.length
  }
  return result
}
