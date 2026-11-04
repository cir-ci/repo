import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export interface LocalScreenshot {
  /** Relative path without `.png`, using `/` on every OS: the name screenshots are paired by. */
  name: string
  path: string
  sha256: string
  size: number
  metadata?: Record<string, unknown>
}

const MAX_BYTES = 25 * 1024 * 1024

/**
 * Finds every `*.png` under `dir` (skipping hidden folders and node_modules), hashes it, and
 * reads an optional `<file>.png.json` sidecar with metadata (browser, viewport, test…).
 */
export async function collectScreenshots(dir: string): Promise<LocalScreenshot[]> {
  const paths = await walk(dir)
  const shots = await Promise.all(
    paths.map(async (path): Promise<LocalScreenshot> => {
      const { size } = await stat(path)
      if (size > MAX_BYTES) throw new Error(`${path} is ${size} bytes; the limit is ${MAX_BYTES}`)
      const metadata = await readSidecar(`${path}.json`)
      const shot: LocalScreenshot = {
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
    }),
  )
  return shots.toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (e): Promise<string[]> => {
      if (e.name.startsWith('.') || e.name === 'node_modules') return []
      const full = join(dir, e.name)
      if (e.isDirectory()) return walk(full)
      return e.isFile() && /\.png$/i.test(e.name) ? [full] : []
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
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object`)
  }
  return Object.fromEntries(Object.entries(parsed))
}
