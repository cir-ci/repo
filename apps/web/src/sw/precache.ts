/**
 * What the service worker fetches in the background after the first load, so later pages and
 * first visits to other pages are instant. The list comes from the build (`vite.config.ts`);
 * the rules here are pure so they are tested in Node.
 */

/** A file the build wrote: its path inside `dist` and, for a script, the modules it holds. */
export interface BuiltFile {
  fileName: string
  /** The chunk's name (`icons`, `react`…); absent for an asset. */
  name?: string | undefined
  moduleIds?: readonly string[] | undefined
}

const LUCIDE_ICON = /lucide-react[\\/]dist[\\/]esm[\\/]icons[\\/]/

/** A script that is only one of the project icon picker's ~1,700 icons, loaded one at a time when a picker opens. */
function isPickerIcon(file: BuiltFile): boolean {
  if (file.name === 'icons' || !file.moduleIds || file.moduleIds.length === 0) return false
  return file.moduleIds.every((id) => LUCIDE_ICON.test(id))
}

const isCode = (name: string) => /\.(js|css)$/.test(name)

/**
 * The hashed files worth fetching ahead: every script, style and image under `/assets/`, and the
 * Latin fonts (a Cyrillic or Greek font file loads only on a page that needs one), but not source
 * maps and not the picker's icons. Scripts and styles first, then the rest, each sorted.
 */
export function precacheEntries(files: readonly BuiltFile[]): string[] {
  const picked = files.filter((file) => {
    if (!file.fileName.startsWith('assets/') || file.fileName.endsWith('.map')) return false
    if (/\.woff2?$/.test(file.fileName)) return file.fileName.includes('-latin-')
    return !isPickerIcon(file)
  })
  const paths = picked.map((file) => `/${file.fileName}`)
  return [...new Set(paths)].toSorted(
    (a, b) => Number(isCode(b)) - Number(isCode(a)) || a.localeCompare(b),
  )
}

/** `/assets/index-BfQYrdej.js` without its hash: `/assets/index.js`. */
export function withoutHash(path: string): string {
  return path.replace(/-[A-Za-z0-9_-]{8}(\.[^./]+)$/, '$1')
}

/**
 * Kept files that an older build wrote: not in `manifest`, but a file of the same name (hash
 * apart) is. A file the manifest has no namesake for (an icon the picker fetched) stays.
 */
export function staleEntries(kept: readonly string[], manifest: readonly string[]): string[] {
  const current = new Set(manifest)
  const names = new Set(manifest.map(withoutHash))
  return kept.filter(
    (path) => path.startsWith('/assets/') && !current.has(path) && names.has(withoutHash(path)),
  )
}

/** What of the manifest isn't kept yet. */
export function missingEntries(kept: readonly string[], manifest: readonly string[]): string[] {
  const have = new Set(kept)
  return manifest.filter((path) => !have.has(path))
}
