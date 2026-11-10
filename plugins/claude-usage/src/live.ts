import type { LiveSession } from './advice'
import { attribute, type AttributionMap } from './attribution'
import type { SessionOwners } from './bbAttribution'
import { contextTokens, normalizeModelId, PRICE_TABLE } from './pricing'
import type { TranscriptFileSystem, TranscriptStat } from './scanner'
import type { CacheTtl } from './sessionAnalysis'
import { isBillable, parseTranscriptEntry, type BilledResponse } from './transcript'

/**
 * Claude Code prunes transcripts after about a month, so this covers every
 * thread that can still be resumed. Only tails that changed are re-read.
 */
export const LIVE_WINDOW_MS = 30 * 86_400_000
/**
 * A transcript's tail can be all tool output, so the read widens until it
 * reaches a response. Past the last size the session has no response worth
 * pricing.
 */
const TAIL_SIZES = [256 * 1024, 2 * 1024 * 1024, 8 * 1024 * 1024]
/** A Claude Code compaction summary runs to a few thousand tokens. */
const SUMMARY_OUTPUT_TOKENS = 8_000
/** What a conversation usually holds right after compaction: system prompt, tools, and the summary. */
const COMPACTED_CONTEXT_TOKENS = 30_000

export interface LiveState {
  last: BilledResponse
  title: string | null
  cacheTtl: CacheTtl
}

interface Tracked {
  sizeBytes: number
  modifiedAt: number | null
  state: LiveState | null
}

function isSubagent(path: string): boolean {
  return path.includes('/subagents/')
}

/** Reads the newest response, title, and cache lifetime from the end of a transcript. */
export function parseTail(text: string, startsMidLine: boolean): LiveState | null {
  const lines = text.split('\n')
  if (startsMidLine) lines.shift()
  let last: BilledResponse | null = null
  let title: string | null = null
  let cacheTtl: CacheTtl | null = null
  for (const line of lines) {
    const entry = parseTranscriptEntry(line)
    if (!entry) continue
    if (entry.kind === 'title') title = entry.title
    if (entry.kind !== 'response' || !isBillable(entry.response)) continue
    // Streamed records of one response repeat its id; the last carries the full usage.
    last = entry.response
    const { cacheWrite5m, cacheWrite1h } = entry.response.tokens
    if (cacheWrite5m > 0 || cacheWrite1h > 0) cacheTtl = cacheWrite1h > cacheWrite5m ? '1h' : '5m'
  }
  return last ? { last, title, cacheTtl: cacheTtl ?? '5m' } : null
}

async function readLiveState(fs: TranscriptFileSystem, root: string, stat: TranscriptStat): Promise<LiveState | null> {
  for (const bytes of TAIL_SIZES) {
    const text = await fs.readTextTail({ root, path: stat.path, bytes })
    const state = parseTail(text, stat.sizeBytes > bytes)
    if (state || stat.sizeBytes <= bytes) return state
  }
  return null
}

/** Keeps the newest state of every recently written transcript, re-reading only tails that changed. */
export function createLiveTracker() {
  const tracked = new Map<string, Tracked>()

  return {
    async refresh(
      fs: TranscriptFileSystem,
      root: string,
      transcripts: TranscriptStat[],
      now: number,
      onError?: (message: string, error: unknown) => void,
    ): Promise<void> {
      const seen = new Set<string>()
      for (const stat of transcripts) {
        if (isSubagent(stat.path) || stat.modifiedAt === null || now - stat.modifiedAt > LIVE_WINDOW_MS) continue
        seen.add(stat.path)
        const known = tracked.get(stat.path)
        if (known && known.sizeBytes === stat.sizeBytes && known.modifiedAt === stat.modifiedAt) continue
        try {
          const state = await readLiveState(fs, root, stat)
          tracked.set(stat.path, { sizeBytes: stat.sizeBytes, modifiedAt: stat.modifiedAt, state })
        } catch (error) {
          onError?.(`failed to read the end of ${stat.path}`, error)
        }
      }
      for (const path of tracked.keys()) if (!seen.has(path)) tracked.delete(path)
    },
    states(): Array<{ path: string; state: LiveState }> {
      return [...tracked.entries()].flatMap(([path, entry]) => (entry.state ? [{ path, state: entry.state }] : []))
    },
  }
}

export type LiveTracker = ReturnType<typeof createLiveTracker>

function sessionIdOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.jsonl$/, '')
}

/**
 * Names the thread whose next message a transcript prices. bb's identity
 * events say exactly which session a thread is on, which matters when hidden
 * helper threads share its worktree. A thread's earlier sessions are history
 * and drop out. Only a session bb never named falls back to the directory,
 * and then not onto a thread that bb says is on another session.
 */
function threadOf(
  path: string,
  cwd: string,
  attributionMap: AttributionMap,
  owners: SessionOwners | null,
): { thread: ReturnType<typeof attribute>['thread']; superseded: boolean } {
  const sessionId = sessionIdOf(path)
  const ownerId = owners?.ownerOf.get(sessionId)
  if (ownerId) {
    if (owners!.currentOf.get(ownerId) !== sessionId) return { thread: null, superseded: true }
    return { thread: attributionMap.threadsById.get(ownerId) ?? null, superseded: false }
  }
  const thread = attribute(attributionMap, cwd).thread
  if (thread && owners?.currentOf.has(thread.threadId)) return { thread: null, superseded: false }
  return { thread, superseded: false }
}

/**
 * One entry per thread, the transcript of the session it is on now, since
 * that is what its next message pays for. Sessions no thread owns are listed
 * on their own.
 */
export function buildLiveSessions(
  states: Array<{ path: string; state: LiveState }>,
  attributionMap: AttributionMap,
  fallbackTitles: ReadonlyMap<string, string>,
  owners: SessionOwners | null = null,
): LiveSession[] {
  const byOwner = new Map<string, LiveSession>()
  for (const { path, state } of states) {
    const price = PRICE_TABLE[normalizeModelId(state.last.model)]
    if (!price) continue
    const context = contextTokens(state.last.tokens)
    const writeRate = state.cacheTtl === '1h' ? price.cacheWrite1h : price.cacheWrite5m
    const { project } = attribute(attributionMap, state.last.cwd)
    const { thread, superseded } = threadOf(path, state.last.cwd, attributionMap, owners)
    if (superseded) continue
    const session: LiveSession = {
      path,
      title: state.title ?? fallbackTitles.get(path) ?? null,
      threadId: thread?.threadId ?? null,
      threadTitle: thread?.threadTitle ?? null,
      projectName: project.kind === 'project' ? project.projectName : null,
      model: normalizeModelId(state.last.model),
      lastAt: state.last.timestamp,
      context,
      cacheTtl: state.cacheTtl,
      recacheCost: (context * writeRate) / 1_000_000,
      warmCallCost: (context * price.cacheRead) / 1_000_000,
      summaryOutputCost: (SUMMARY_OUTPUT_TOKENS * price.output) / 1_000_000,
      compactedCallCost: (COMPACTED_CONTEXT_TOKENS * price.cacheRead) / 1_000_000,
    }
    const owner = session.threadId ? `thread:${session.threadId}` : `path:${path}`
    const existing = byOwner.get(owner)
    if (!existing || existing.lastAt < session.lastAt) byOwner.set(owner, session)
  }
  return [...byOwner.values()].sort((left, right) => right.lastAt - left.lastAt)
}
