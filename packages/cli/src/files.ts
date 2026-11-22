import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

import { mapLimit } from './concurrency.ts'
import { UsageError } from './errors.ts'

export namespace collectScreenshots {
  export interface Screenshot {
    /** Relative path without `.png`, using `/` on every OS: the name screenshots are paired by. */
    name: string
    path: string
    sha256: string
    size: number
    metadata?: Record<string, unknown>
  }
}

const MAX_BYTES = 25 * 1024 * 1024
/** Files read and hashed at once: enough to keep the disk busy, few enough to stay under the descriptor limit. */
const HASH_CONCURRENCY = 8

/**
 * Finds every `*.png` under `dir` (skipping hidden folders and node_modules; symbolic links to
 * files and folders are followed, a link back up the tree is not), hashes it, and reads an
 * optional `<file>.png.json` sidecar with metadata (browser, viewport, test…).
 */
export async function collectScreenshots(dir: string): Promise<collectScreenshots.Screenshot[]> {
  const info = await stat(dir).catch(() => undefined)
  if (!info) throw new UsageError(`No such directory: ${dir}`)
  if (!info.isDirectory()) throw new UsageError(`${dir} is not a directory`)
  const paths = await walk(dir, [])
  const shots = await mapLimit(paths, HASH_CONCURRENCY, async (path) => {
    const { size } = await stat(path)
    if (size > MAX_BYTES) {
      throw new UsageError(
        `${path} is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB per screenshot`,
      )
    }
    const metadata = await readSidecar(`${path}.json`)
    const shot: collectScreenshots.Screenshot = {
      name: relative(dir, path)
        .split(sep)
        .join('/')
        .replace(/\.png$/i, ''),
      path,
      sha256: await hashFile(path),
      size,
    }
    if (metadata) shot.metadata = metadata
    return shot
  })
  return shots.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** `ancestors` are the real paths of the folders above, so a link that loops back is skipped. */
async function walk(dir: string, ancestors: string[]): Promise<string[]> {
  const real = await realpath(dir)
  if (ancestors.includes(real)) return []
  const chain = [...ancestors, real]
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      if (e.name.startsWith('.') || e.name === 'node_modules') return []
      const full = join(dir, e.name)
      // A link is judged by what it points at; a dangling one is skipped.
      const target = e.isSymbolicLink() ? await stat(full).catch(() => undefined) : e
      if (!target) return []
      if (target.isDirectory()) return walk(full, chain)
      return target.isFile() && /\.png$/i.test(e.name) ? [full] : []
    }),
  )
  return nested.flat()
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function readSidecar(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new UsageError(
      `${path} isn't valid JSON (${err instanceof Error ? err.message : String(err)})`,
    )
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UsageError(`${path} must contain a JSON object`)
  }
  return Object.fromEntries(Object.entries(parsed))
}
