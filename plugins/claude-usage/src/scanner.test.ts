import { describe, expect, it, vi } from 'vitest'
import { emptySpendIndex, indexTranscript, iterateRows, mergeTranscript } from './spendIndex'
import { fakeFileSystem, usageLine } from './fakeFileSystem'
import { listTranscripts, resolveTranscriptRoot, scanTranscripts, type TranscriptFileSystem } from './scanner'

const ROOT = '/home/dev/.claude/projects'

describe('resolveTranscriptRoot', () => {
  it('honours CLAUDE_CONFIG_DIR so a relocated Claude Code install is still read', () => {
    expect(resolveTranscriptRoot({ CLAUDE_CONFIG_DIR: '/custom/claude' })).toBe('/custom/claude/projects')
  })

  it('falls back to the home directory when the override is blank', () => {
    expect(resolveTranscriptRoot({ CLAUDE_CONFIG_DIR: '   ' })).toMatch(/\.claude\/projects$/)
  })
})

describe('listTranscripts', () => {
  it('finds subagent transcripts nested below a session directory', async () => {
    const fs = fakeFileSystem({
      'proj': null,
      'proj/session.jsonl': usageLine(),
      'proj/session': null,
      'proj/session/subagents': null,
      'proj/session/subagents/agent-1.jsonl': usageLine({ id: 'msg_2' }),
    })

    const found = await listTranscripts(fs, ROOT)

    expect(found.map((entry) => entry.path).sort()).toEqual([
      'proj/session.jsonl',
      'proj/session/subagents/agent-1.jsonl',
    ])
  })

  it('ignores files that are not transcripts', async () => {
    const fs = fakeFileSystem({ 'proj': null, 'proj/notes.md': 'hi', 'proj/session.jsonl': usageLine() })

    expect(await listTranscripts(fs, ROOT)).toHaveLength(1)
  })

  it('survives a directory it cannot read', async () => {
    const fs = fakeFileSystem({ 'proj': null, 'proj/session.jsonl': usageLine() })
    const failing: TranscriptFileSystem = {
      readDir: (request) => (request.path === 'proj' ? Promise.reject(new Error('EACCES')) : fs.readDir(request)),
      readTextFileChunks: fs.readTextFileChunks,
    }

    expect(await listTranscripts(failing, ROOT)).toEqual([])
  })
})

describe('scanTranscripts', () => {
  it('indexes a subagent transcript alongside its parent, since their responses are disjoint', async () => {
    const fs = fakeFileSystem({
      'proj': null,
      'proj/session.jsonl': usageLine({ id: 'msg_1' }),
      'proj/session': null,
      'proj/session/subagents': null,
      'proj/session/subagents/agent-1.jsonl': usageLine({ id: 'msg_2' }),
    })
    const index = emptySpendIndex()

    const result = await scanTranscripts({ fs, root: ROOT, index })

    expect(result).toMatchObject({ transcriptsSeen: 2, responsesIndexed: 2 })
    expect(result.readPaths).toHaveLength(2)
    expect([...iterateRows(index)].reduce((sum, row) => sum + row.tokens.output, 0)).toBe(200)
  })

  it('collapses a streamed response spread over several records to its complete usage', async () => {
    const fs = fakeFileSystem({
      'proj': null,
      'proj/session.jsonl': [
        usageLine({ output: 6 }),
        usageLine({ output: 6 }),
        usageLine({ output: 206 }),
      ].join('\n'),
    })
    const index = emptySpendIndex()

    await scanTranscripts({ fs, root: ROOT, index })

    expect([...iterateRows(index)][0]!.tokens.output).toBe(206)
  })

  it('skips a transcript it has already read at the same size and mtime', async () => {
    const content = usageLine()
    const fs = fakeFileSystem({ 'proj': null, 'proj/session.jsonl': content })
    const index = emptySpendIndex()
    mergeTranscript(index, 'proj/session.jsonl', indexTranscript([], { sizeBytes: content.length, modifiedAt: 7 }))
    const chunks = vi.spyOn(fs, 'readTextFileChunks')

    const result = await scanTranscripts({ fs, root: ROOT, index })

    expect(result).toMatchObject({ transcriptsSeen: 1, readPaths: [] })
    expect(chunks).not.toHaveBeenCalled()
  })

  it('counts a transcript it cannot read and keeps scanning the rest', async () => {
    const fs = fakeFileSystem({
      'proj': null,
      'proj/broken.jsonl': usageLine(),
      'proj/good.jsonl': usageLine({ id: 'msg_2' }),
    })
    const failing: TranscriptFileSystem = {
      readDir: fs.readDir,
      readTextFileChunks: (request) => {
        if (request.path === 'proj/broken.jsonl') throw new Error('EACCES')
        return fs.readTextFileChunks(request)
      },
    }
    const index = emptySpendIndex()

    const result = await scanTranscripts({ fs: failing, root: ROOT, index })

    expect(result).toMatchObject({ transcriptsFailed: 1, readPaths: ['proj/good.jsonl'] })
  })

  it('propagates an abort so a stopping background service does not keep reading', async () => {
    const fs = fakeFileSystem({ 'proj': null, 'proj/session.jsonl': usageLine() })
    const controller = new AbortController()
    controller.abort()

    await expect(
      scanTranscripts({ fs, root: ROOT, index: emptySpendIndex(), signal: controller.signal }),
    ).rejects.toThrow()
  })
})
