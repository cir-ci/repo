import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Finding the captures a Vitest run left in `.circi/screenshots/vitest`, for upload. */

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (e) => {
      const path = join(dir, e.name)
      if (e.isDirectory()) return e.name === 'node_modules' || e.name === '.git' ? [] : walk(path)
      return e.name.endsWith('.png') ? [path] : []
    }),
  )
  return nested.flat()
}

export interface CollectedScreenshot {
  /** Absolute path of the file. */
  path: string
  /** The name CirCI shows, from the path: stable between runs, unique across the suite. */
  name: string
}

/** Everything under `dir`, named by its path relative to it. */
export async function collectDirectory(dir: string): Promise<CollectedScreenshot[]> {
  return (await walk(dir)).map((path) => ({
    path,
    name: relative(dir, path)
      .split(sep)
      .join('/')
      .replace(/\.png$/, ''),
  }))
}
