import type { TranscriptFileSystem } from './scanner'

export function usageLine(overrides: { id?: string; output?: number; cwd?: string; at?: string } = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: overrides.at ?? '2026-08-27T09:15:00.000Z',
    cwd: overrides.cwd ?? '/worktrees/KVG-1',
    message: {
      id: overrides.id ?? 'msg_1',
      model: 'claude-opus-5',
      usage: { input_tokens: 1, output_tokens: overrides.output ?? 100, cache_read_input_tokens: 0 },
    },
  })
}

export function fakeFileSystem(tree: Record<string, string | null>): TranscriptFileSystem {
  const dirOf = (path: string) => path.split('/').slice(0, -1).join('/')
  return {
    async readDir({ path }) {
      const parent = path ?? ''
      return Object.entries(tree)
        .filter(([entryPath]) => dirOf(entryPath) === parent)
        .map(([entryPath, content]) => ({
          name: entryPath.split('/').pop()!,
          path: entryPath,
          isDir: content === null,
          size: content?.length ?? null,
          modifiedAt: content === null ? null : 7,
        }))
    },
    readTextFileChunks({ path }) {
      const content = tree[path]
      if (typeof content !== 'string') throw new Error(`no such transcript: ${path}`)
      return (async function* () {
        for (let offset = 0; offset < content.length; offset += 16) yield content.slice(offset, offset + 16)
      })()
    },
  }
}
