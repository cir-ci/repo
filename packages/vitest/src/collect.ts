import { readdir } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/**
 * Finding the pictures a Vitest run left behind, for upload.
 *
 * - **Helper mode:** everything under `.circi/screenshots` (what `circiScreenshot` writes).
 * - **Collection mode:** the actual screenshots Vitest's own `toMatchScreenshot` writes, in
 *   `__screenshots__` folders next to the tests, so a suite can adopt CirCI without changing it.
 */

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

/**
 * `toMatchScreenshot` keeps, per test file, `__screenshots__/<file>/<test name>-<browser>-<os>.png`
 * for the reference and `.vitest-attachments`/`-actual` or `-diff` siblings for failures.
 * Only the reference-named files (no `-actual`/`-diff`) are collected, named by their path
 * without the `__screenshots__` folder.
 */
export async function collectToMatchScreenshot(root: string): Promise<CollectedScreenshot[]> {
  const found = await walk(root)
  return found
    .map((path) => ({ path, rel: relative(root, path).split(sep) }))
    .filter(
      ({ rel }) =>
        rel.includes('__screenshots__') && !/-(actual|diff)\.png$/.test(rel.at(-1) ?? ''),
    )
    .map(({ path, rel }) => ({
      path,
      name: rel
        .filter((p) => p !== '__screenshots__')
        .join('/')
        .replace(/\.png$/, ''),
    }))
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
