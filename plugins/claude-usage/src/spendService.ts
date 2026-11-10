import type { LiveSession } from './advice'
import { buildAttributionMap, type AttributionMap, type AttributionSource } from './attribution'
import { buildDashboard, buildThreadSpend, type SpendDashboardData, type ThreadSpendData } from './dashboard'
import type { SqlDatabase } from './database'
import { loadSpendIndex, saveTranscripts } from './indexStore'
import type { SessionOwners } from './bbAttribution'
import { buildLiveSessions, createLiveTracker } from './live'
import { listTranscripts, scanTranscripts, type ScanResult, type TranscriptFileSystem } from './scanner'
import type { SpendIndex } from './spendIndex'

const ATTRIBUTION_TTL_MS = 30_000
/** Every open bb window polls; one tail pass serves all of them for this long. */
const LIVE_REFRESH_MS = 10_000
const EMPTY_SOURCE: AttributionSource = { projects: [], environments: [], threads: [] }

export interface SpendServiceDependencies {
  db: SqlDatabase
  fs: TranscriptFileSystem
  root: string
  loadAttributionSource(): Promise<AttributionSource>
  /** Which session each thread is on; without it, live sessions match threads by directory alone. */
  loadSessionOwners?(): Promise<SessionOwners>
  now(): number
  onError?(message: string, error: unknown): void
}

export interface DashboardResult extends SpendDashboardData {
  indexing: boolean
}

export interface SpendService {
  refresh(signal?: AbortSignal): Promise<ScanResult>
  getDashboard(): Promise<DashboardResult>
  getThreadSpend(threadId: string): Promise<ThreadSpendData>
  getLiveSessions(): Promise<{ generatedAt: number; sessions: LiveSession[] }>
}

export function createSpendService(dependencies: SpendServiceDependencies): SpendService {
  let index: SpendIndex = loadSpendIndex(dependencies.db)
  let scannedOnce = false
  let queue: Promise<unknown> = Promise.resolve()
  let attributionMap: AttributionMap | null = null
  let attributionLoadedAt = 0
  let sessionOwners: SessionOwners | null = null
  let sessionOwnersLoadedAt = -Infinity
  const live = createLiveTracker()
  let liveRefreshedAt = -Infinity
  let liveRefresh: Promise<void> | null = null

  /** Concurrent callers share one pass instead of each reading every tail. */
  function refreshLive(): Promise<void> {
    if (dependencies.now() - liveRefreshedAt < LIVE_REFRESH_MS) return Promise.resolve()
    liveRefresh ??= (async () => {
      try {
        const transcripts = await listTranscripts(dependencies.fs, dependencies.root)
        await live.refresh(dependencies.fs, dependencies.root, transcripts, dependencies.now(), dependencies.onError)
        liveRefreshedAt = dependencies.now()
      } finally {
        liveRefresh = null
      }
    })()
    return liveRefresh
  }

  async function currentSessionOwners(): Promise<SessionOwners | null> {
    const load = dependencies.loadSessionOwners
    if (!load) return null
    const now = dependencies.now()
    if (now - sessionOwnersLoadedAt < ATTRIBUTION_TTL_MS) return sessionOwners
    try {
      sessionOwners = await load()
      sessionOwnersLoadedAt = now
    } catch (error) {
      dependencies.onError?.('failed to read thread sessions', error)
    }
    return sessionOwners
  }

  function indexedTitles(): Map<string, string> {
    const titles = new Map<string, string>()
    for (const [path, transcript] of index.transcripts) {
      if (transcript.session?.title) titles.set(path, transcript.session.title)
    }
    return titles
  }

  /**
   * Scans a copy and swaps it in only after the rows are stored: a transcript
   * read in memory but never stored would pass `needsRescan` from then on and
   * never reach the database.
   */
  async function scanOnce(signal?: AbortSignal): Promise<ScanResult> {
    const working: SpendIndex = { transcripts: new Map(index.transcripts) }
    const result = await scanTranscripts({ fs: dependencies.fs, root: dependencies.root, index: working, signal })
    saveTranscripts(dependencies.db, working, result.readPaths)
    index = working
    scannedOnce = true
    return result
  }

  async function currentAttributionMap(): Promise<AttributionMap> {
    const now = dependencies.now()
    if (attributionMap && now - attributionLoadedAt < ATTRIBUTION_TTL_MS) return attributionMap
    try {
      attributionMap = buildAttributionMap(await dependencies.loadAttributionSource())
      attributionLoadedAt = now
    } catch (error) {
      dependencies.onError?.('failed to resolve spend attribution', error)
      attributionMap ??= buildAttributionMap(EMPTY_SOURCE)
    }
    return attributionMap
  }

  return {
    refresh(signal) {
      const run = queue.then(() => scanOnce(signal))
      queue = run.catch(() => undefined)
      return run
    },
    async getDashboard() {
      const dashboard = buildDashboard(index, await currentAttributionMap(), dependencies.now())
      return { ...dashboard, indexing: !scannedOnce && index.transcripts.size === 0 }
    },
    async getThreadSpend(threadId) {
      return buildThreadSpend(index, await currentAttributionMap(), threadId)
    },
    async getLiveSessions() {
      await refreshLive()
      return {
        generatedAt: dependencies.now(),
        sessions: buildLiveSessions(
          live.states(),
          await currentAttributionMap(),
          indexedTitles(),
          await currentSessionOwners(),
        ),
      }
    },
  }
}
