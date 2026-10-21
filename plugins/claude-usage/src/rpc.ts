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
})

export type Dashboard = z.infer<typeof dashboard>

export const rpcContract = defineRpcContract({
  dashboard: { input: z.null(), output: dashboard },
  threadSpend: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ threadId: z.string(), found: z.boolean(), total: z.number() }),
  },
  rescan: {
    input: z.null(),
    output: z.object({ transcriptsSeen: z.number(), transcriptsRead: z.number(), transcriptsFailed: z.number() }),
  },
})

export function createRpcHandlers(service: SpendService) {
  return {
    dashboard: () => service.getDashboard(),
    threadSpend: ({ threadId }: { threadId: string }) => service.getThreadSpend(threadId),
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
