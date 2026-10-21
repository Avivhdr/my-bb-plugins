import { describe, expect, it } from 'vitest'
import { fakeFileSystem, usageLine } from './fakeFileSystem'
import { createRpcHandlers, rpcContract } from './rpc'
import { createSpendService } from './spendService'
import { migratedDatabase } from './testDatabase'

const handlers = () =>
  createRpcHandlers(
    createSpendService({
      db: migratedDatabase(),
      fs: fakeFileSystem({ proj: null, 'proj/a.jsonl': usageLine({ cwd: '/worktrees/thr_1' }) }),
      root: '/root',
      loadAttributionSource: async () => ({
        projects: [{ id: 'P-1', name: 'frontend', paths: [] }],
        environments: [{ id: 'E-1', projectId: 'P-1', path: '/worktrees/thr_1' }],
        threads: [{ id: 'thr_1', title: 'Fix', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' }],
      }),
      now: () => Date.parse('2026-08-27T12:00:00.000Z'),
    }),
  )

describe('rpc handlers', () => {
  it('return a dashboard the contract accepts, before and after a rescan', async () => {
    const rpc = handlers()

    expect(rpcContract.dashboard.output.parse(await rpc.dashboard())).toMatchObject({ indexing: true })
    expect(rpcContract.rescan.output.parse(await rpc.rescan())).toEqual({
      transcriptsSeen: 1,
      transcriptsRead: 1,
      transcriptsFailed: 0,
    })
    expect(rpcContract.dashboard.output.parse(await rpc.dashboard())).toMatchObject({
      indexing: false,
      transcriptCount: 1,
    })
  })

  it('return the no-spend state for a thread with no recorded spend', async () => {
    const rpc = handlers()
    await rpc.rescan()

    expect(rpcContract.threadSpend.output.parse(await rpc.threadSpend({ threadId: 'thr_other' }))).toEqual({
      threadId: 'thr_other',
      found: false,
      total: 0,
    })
    expect(await rpc.threadSpend({ threadId: 'thr_1' })).toMatchObject({ threadId: 'thr_1', found: true })
  })

  it('reject a thread id that is empty', () => {
    expect(rpcContract.threadSpend.input.safeParse({ threadId: '' }).success).toBe(false)
  })
})
