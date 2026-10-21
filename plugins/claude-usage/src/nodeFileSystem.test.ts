import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeTranscriptFileSystem } from './nodeFileSystem'
import { listTranscripts } from './scanner'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'claude-usage-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let text = ''
  for await (const chunk of chunks) text += chunk
  return text
}

describe('nodeTranscriptFileSystem', () => {
  it('lists transcripts with root-relative paths, sizes, and mtimes, including subagents', async () => {
    await mkdir(join(root, '-code-app', 'session-1', 'subagents'), { recursive: true })
    await writeFile(join(root, '-code-app', 'session-1.jsonl'), 'abc\n')
    await writeFile(join(root, '-code-app', 'session-1', 'subagents', 'agent-a.jsonl'), 'de\n')

    const found = await listTranscripts(nodeTranscriptFileSystem, root)

    expect(found.map(({ path, sizeBytes }) => ({ path, sizeBytes })).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: '-code-app/session-1.jsonl', sizeBytes: 4 },
      { path: '-code-app/session-1/subagents/agent-a.jsonl', sizeBytes: 3 },
    ])
    expect(found.every((stat) => typeof stat.modifiedAt === 'number')).toBe(true)
  })

  it('reads a file in chunks that rejoin to its full content', async () => {
    const content = `${'x'.repeat(1000)}\n${'y'.repeat(1000)}\n`
    await writeFile(join(root, 'a.jsonl'), content)

    const text = await collect(
      nodeTranscriptFileSystem.readTextFileChunks({ root, path: 'a.jsonl', chunkSizeBytes: 64 }),
    )

    expect(text).toBe(content)
  })

  it('refuses a path that escapes the root', async () => {
    await expect(
      collect(nodeTranscriptFileSystem.readTextFileChunks({ root, path: '../outside.jsonl' })),
    ).rejects.toThrow()
  })
})
