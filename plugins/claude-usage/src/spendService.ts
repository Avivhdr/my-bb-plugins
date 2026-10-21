import { buildAttributionMap, type AttributionMap, type AttributionSource } from './attribution'
import { buildDashboard, buildThreadSpend, type SpendDashboardData, type ThreadSpendData } from './dashboard'
import type { SqlDatabase } from './database'
import { loadSpendIndex, saveTranscripts } from './indexStore'
import { scanTranscripts, type ScanResult, type TranscriptFileSystem } from './scanner'
import type { SpendIndex } from './spendIndex'

const ATTRIBUTION_TTL_MS = 30_000
const EMPTY_SOURCE: AttributionSource = { projects: [], environments: [], threads: [] }

export interface SpendServiceDependencies {
  db: SqlDatabase
  fs: TranscriptFileSystem
  root: string
  loadAttributionSource(): Promise<AttributionSource>
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
}

export function createSpendService(dependencies: SpendServiceDependencies): SpendService {
  let index: SpendIndex = loadSpendIndex(dependencies.db)
  let scannedOnce = false
  let queue: Promise<unknown> = Promise.resolve()
  let attributionMap: AttributionMap | null = null
  let attributionLoadedAt = 0

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
  }
}
