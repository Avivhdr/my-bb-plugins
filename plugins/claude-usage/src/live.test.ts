import { describe, expect, it, vi } from 'vitest'
import { buildAttributionMap } from './attribution'
import { fakeFileSystem } from './fakeFileSystem'
import { buildLiveSessions, createLiveTracker, parseTail } from './live'
import { listTranscripts } from './scanner'

const ROOT = '/home/dev/.claude/projects'

function usage(id: string, at: string, usage: Record<string, unknown>, model = 'claude-opus-5', cwd = '/worktrees/thr_1') {
  return JSON.stringify({ type: 'assistant', timestamp: at, cwd, message: { id, model, usage } })
}

const map = buildAttributionMap({
  projects: [{ id: 'P-1', name: 'frontend', paths: ['/code/frontend'] }],
  environments: [{ id: 'E-1', projectId: 'P-1', path: '/worktrees/thr_1' }],
  threads: [{ id: 'thr_1', title: 'Fix the panel', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' }],
})

describe('parseTail', () => {
  it('reads the newest response and title and drops a cut-off first line', () => {
    const text = [
      '"cut": "mid-record"}',
      usage('msg_1', '2026-08-27T11:00:00.000Z', { input_tokens: 1, output_tokens: 5, cache_creation_input_tokens: 9 }),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Fix the panel' }),
      usage('msg_2', '2026-08-27T11:05:00.000Z', {
        input_tokens: 1,
        output_tokens: 5,
        cache_read_input_tokens: 400_000,
        cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 2_000 },
      }),
    ].join('\n')

    const state = parseTail(text, true)

    expect(state?.last.messageId).toBe('msg_2')
    expect(state?.title).toBe('Fix the panel')
    expect(state?.cacheTtl).toBe('1h')
  })

  it('returns null when the tail holds no response', () => {
    expect(parseTail(JSON.stringify({ type: 'user' }), false)).toBeNull()
  })
})

describe('live tracker', () => {
  it('re-reads only tails that changed and skips subagents and old sessions', async () => {
    const fs = fakeFileSystem({
      proj: null,
      'proj/s.jsonl': usage('msg_1', '2026-08-27T11:00:00.000Z', { output_tokens: 5, cache_read_input_tokens: 10 }),
      'proj/s': null,
      'proj/s/subagents': null,
      'proj/s/subagents/a.jsonl': usage('msg_2', '2026-08-27T11:00:00.000Z', { output_tokens: 5 }),
    })
    const tail = vi.spyOn(fs, 'readTextTail')
    const tracker = createLiveTracker()
    const transcripts = await listTranscripts(fs, ROOT)

    // The fake stamps every file with mtime 7, so "now" sits just after it.
    await tracker.refresh(fs, ROOT, transcripts, 1_000)
    await tracker.refresh(fs, ROOT, transcripts, 1_000)

    expect(tail).toHaveBeenCalledTimes(1)
    expect(tracker.states().map((entry) => entry.path)).toEqual(['proj/s.jsonl'])

    await tracker.refresh(fs, ROOT, transcripts, 7 + 31 * 86_400_000)
    expect(tracker.states()).toEqual([])
  })
})

describe('buildLiveSessions', () => {
  const state = (id: string, at: string, cacheRead: number, model = 'claude-opus-5') => ({
    last: {
      messageId: id,
      model,
      timestamp: Date.parse(at),
      cwd: '/worktrees/thr_1',
      tokens: { input: 0, output: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead },
    },
    title: null,
    cacheTtl: '5m' as const,
  })

  it('keeps the newest session per thread and prices its next call both ways', () => {
    const sessions = buildLiveSessions(
      [
        { path: 'proj/old.jsonl', state: state('a', '2026-08-27T09:00:00.000Z', 100_000) },
        { path: 'proj/new.jsonl', state: state('b', '2026-08-27T11:00:00.000Z', 400_000) },
      ],
      map,
      new Map([['proj/new.jsonl', 'Indexed title']]),
    )

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({
      path: 'proj/new.jsonl',
      title: 'Indexed title',
      threadId: 'thr_1',
      projectName: 'frontend',
      context: 400_000,
      recacheCost: 2.5,
      warmCallCost: 0.2,
    })
  })

  it('leaves out a model the price table cannot price', () => {
    const sessions = buildLiveSessions(
      [{ path: 'proj/s.jsonl', state: state('a', '2026-08-27T11:00:00.000Z', 1, 'claude-unreleased-9') }],
      map,
      new Map(),
    )

    expect(sessions).toEqual([])
  })
})

describe('buildLiveSessions with bb session identities', () => {
  const shared = buildAttributionMap({
    projects: [{ id: 'P-1', name: 'dgc-aggregator', paths: ['/code/dgc'] }],
    environments: [{ id: 'E-1', projectId: 'P-1', path: '/worktrees/thr_bot' }],
    threads: [
      { id: 'thr_bot', title: 'Gron Bot', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code' },
      { id: 'thr_helper', title: '', projectId: 'P-1', environmentId: 'E-1', providerId: 'claude-code', hidden: true },
    ],
  })
  const at = (id: string, time: string, cacheRead: number) => ({
    last: {
      messageId: id,
      model: 'claude-opus-5',
      timestamp: Date.parse(time),
      cwd: '/worktrees/thr_bot',
      tokens: { input: 0, output: 10, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead },
    },
    title: null,
    cacheTtl: '5m' as const,
  })
  const owners = {
    ownerOf: new Map([
      ['bot-old', 'thr_bot'],
      ['bot-now', 'thr_bot'],
      ['helper', 'thr_helper'],
    ]),
    currentOf: new Map([
      ['thr_bot', 'bot-now'],
      ['thr_helper', 'helper'],
    ]),
  }

  it('prices the session the thread is on, not a newer one a hidden helper wrote in the same worktree', () => {
    const sessions = buildLiveSessions(
      [
        { path: 'proj/bot-now.jsonl', state: at('a', '2026-11-09T21:07:00.000Z', 44_000) },
        { path: 'proj/helper.jsonl', state: at('b', '2026-11-09T21:15:00.000Z', 394_000) },
        { path: 'proj/bot-old.jsonl', state: at('c', '2026-11-09T20:00:00.000Z', 600_000) },
      ],
      shared,
      new Map(),
      owners,
    )

    expect(sessions.find((session) => session.threadId === 'thr_bot')).toMatchObject({
      path: 'proj/bot-now.jsonl',
      context: 44_000,
    })
    expect(sessions.find((session) => session.threadId === 'thr_helper')?.path).toBe('proj/helper.jsonl')
    expect(sessions.map((session) => session.path)).not.toContain('proj/bot-old.jsonl')
  })

  it('does not hand a session bb never named to a thread bb says is on another one', () => {
    const sessions = buildLiveSessions(
      [{ path: 'proj/terminal.jsonl', state: at('a', '2026-11-09T21:20:00.000Z', 300_000) }],
      shared,
      new Map(),
      owners,
    )

    expect(sessions).toEqual([expect.objectContaining({ path: 'proj/terminal.jsonl', threadId: null })])
  })
})
