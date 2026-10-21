import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { TranscriptDirectoryEntry, TranscriptFileSystem } from './scanner'

function resolveInside(root: string, path: string): string {
  const absolute = resolve(root, path)
  const fromRoot = relative(root, absolute)
  if (fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error(`path escapes the transcript root: ${path}`)
  }
  return absolute
}

export const nodeTranscriptFileSystem: TranscriptFileSystem = {
  async readDir({ root, path }) {
    const directory = resolveInside(root, path ?? '')
    const entries = await readdir(directory, { withFileTypes: true })
    const listed: TranscriptDirectoryEntry[] = []
    for (const entry of entries) {
      const relativePath = path ? `${path}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        listed.push({ name: entry.name, path: relativePath, isDir: true, size: null, modifiedAt: null })
      } else if (entry.isFile()) {
        const info = await stat(join(directory, entry.name)).catch(() => null)
        if (!info) continue
        listed.push({
          name: entry.name,
          path: relativePath,
          isDir: false,
          size: info.size,
          modifiedAt: info.mtimeMs,
        })
      }
    }
    return listed
  },

  async *readTextFileChunks({ root, path, chunkSizeBytes, signal }) {
    const stream = createReadStream(resolveInside(root, path), {
      encoding: 'utf8',
      highWaterMark: chunkSizeBytes,
      signal,
    })
    for await (const chunk of stream) yield chunk as string
  },
}
