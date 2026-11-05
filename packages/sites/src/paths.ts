/** Safe paths inside a hosted site. Everything a tarball names goes through `safeEntryPath`. */

/** Prefix reserved for CirCI's own endpoints on every site. */
export const RESERVED_PREFIX = '_circi/'

export class UnsafePathError extends Error {
  constructor(path: string, why: string) {
    super(`"${path}" ${why}`)
    this.name = 'UnsafePathError'
  }
}

/**
 * Turns a tar entry's name into a path relative to the site root, or throws. Rejects absolute
 * paths, `..` segments, NULs and backslashes (a different separator on some systems), anything
 * that normalizes outside the root, and the reserved `_circi/` prefix.
 */
export function safeEntryPath(raw: string): string {
  if (raw.includes('\0')) throw new UnsafePathError(raw, 'contains a NUL byte')
  if (raw.includes('\\')) throw new UnsafePathError(raw, 'contains a backslash')
  if (raw.startsWith('/')) throw new UnsafePathError(raw, 'is an absolute path')
  const parts: string[] = []
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') throw new UnsafePathError(raw, 'leaves the site directory')
    parts.push(segment)
  }
  if (parts.length === 0) throw new UnsafePathError(raw, 'is empty')
  const path = parts.join('/')
  if (`${path}/`.startsWith(RESERVED_PREFIX)) {
    throw new UnsafePathError(raw, `uses the reserved ${RESERVED_PREFIX} prefix`)
  }
  return path
}

/** A request's URL path as a site path (percent-decoded, never outside the root); undefined if unsafe. */
export function requestPath(urlPath: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '')
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined
  const parts: string[] = []
  for (const segment of decoded.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') return undefined
    parts.push(segment)
  }
  return parts.join('/')
}
