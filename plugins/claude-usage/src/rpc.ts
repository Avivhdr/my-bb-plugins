import { defineRpcContract } from '@get-bb/plugin-sdk'
import { z } from 'zod'
import type { SpendService } from './spendService'

const costBreakdown = z.object({
  input: z.number(),
  output: z.number(),
  cacheWrite: z.number(),
  cacheRead: z.number(),
})

const tokenTotals = z.object({
  input: z.number(),
  output: z.number(),
  cacheWrite5m: z.number(),
  cacheWrite1h: z.number(),
  cacheRead: z.number(),
})

const spendFigure = z.object({ total: z.number(), breakdown: costBreakdown, tokens: tokenTotals })

const scopeSpend = z.object({
  key: z.string(),
  label: z.string(),
  projectName: z.string().nullable(),
  total: z.number(),
})

const recacheByGap = z.object({ '5to15m': z.number(), '15to60m': z.number(), over60m: z.number() })

const liveSession = z.object({
  path: z.string(),
  title: z.string().nullable(),
  threadId: z.string().nullable(),
  threadTitle: z.string().nullable(),
  projectName: z.string().nullable(),
  model: z.string(),
  lastAt: z.number(),
  context: z.number(),
  cacheTtl: z.enum(['5m', '1h']),
  recacheCost: z.number(),
  warmCallCost: z.number(),
  summaryOutputCost: z.number(),
  compactedCallCost: z.number(),
})

const dashboard = z.object({
  generatedAt: z.number(),
  indexing: z.boolean(),
  totals: z.object({
    allTime: spendFigure,
    last30Days: spendFigure,
    last7Days: spendFigure,
    today: spendFigure,
  }),
  runRatePerDay: z.number(),
  dailySeries: z.array(z.object({ day: z.string(), total: z.number(), breakdown: costBreakdown })),
  byProject: z.array(scopeSpend),
  byThread: z.array(scopeSpend),
  byModel: z.array(z.object({ model: z.string(), total: z.number(), tokens: z.number() })),
  unpricedModels: z.array(z.object({ model: z.string(), tokens: z.number() })),
  outside: spendFigure,
  transcriptCount: z.number(),
  earliestDay: z.string().nullable(),
  latestDay: z.string().nullable(),
  split: z.object({
    total: z.number(),
    recache: z.number(),
    recacheByGap,
    otherCacheWrite: z.number(),
    cacheRead: z.number(),
    output: z.number(),
    input: z.number(),
  }),
  byContextBand: z.array(
    z.object({
      band: z.enum(['under100k', '100kTo250k', '250kTo500k', 'over500k']),
      total: z.number(),
      calls: z.number(),
    }),
  ),
  topSessions: z.array(
    z.object({
      key: z.string(),
      title: z.string(),
      threadTitle: z.string().nullable(),
      projectName: z.string().nullable(),
      total: z.number(),
      calls: z.number(),
      peakContext: z.number(),
      recache: z.number(),
      lastAt: z.number().nullable(),
      pullRequests: z.array(z.string()),
    }),
  ),
})

export type Dashboard = z.infer<typeof dashboard>
export type LiveSessions = z.infer<typeof liveSessions>

const liveSessions = z.object({ generatedAt: z.number(), sessions: z.array(liveSession) })

export const rpcContract = defineRpcContract({
  dashboard: { input: z.null(), output: dashboard },
  threadSpend: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ threadId: z.string(), found: z.boolean(), total: z.number() }),
  },
  liveSessions: { input: z.null(), output: liveSessions },
  rescan: {
    input: z.null(),
    output: z.object({ transcriptsSeen: z.number(), transcriptsRead: z.number(), transcriptsFailed: z.number() }),
  },
})

export function createRpcHandlers(service: SpendService) {
  return {
    dashboard: () => service.getDashboard(),
    threadSpend: ({ threadId }: { threadId: string }) => service.getThreadSpend(threadId),
    liveSessions: () => service.getLiveSessions(),
    rescan: async () => {
      const result = await service.refresh()
      return {
        transcriptsSeen: result.transcriptsSeen,
        transcriptsRead: result.readPaths.length,
        transcriptsFailed: result.transcriptsFailed,
      }
    },
  }
}
