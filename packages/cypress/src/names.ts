/**
 * Where a screenshot goes and what CirCI calls it. Pure string work; it imports nothing.
 */

export const DEFAULT_DIR = '.circi/screenshots'

function sanitize(input: string): string {
  return input
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-')
}

/**
 * A screenshot's file name from the name given to `cy.screenshot`: the same rule as @circi/vitest
 * (words kept, whitespace to dashes, the rest dropped, `/` keeps folders, nothing escapes upward).
 */
export function captureName(name: string): string {
  const withoutExtension = name.endsWith('.png') ? name.slice(0, -'.png'.length) : name
  const parts = withoutExtension
    .split('/')
    .filter((part) => part !== '..' && part !== '.')
    .map(sanitize)
    .filter((part) => part.length > 0)
  if (parts.length === 0) throw new Error(`"${name}" is not a usable screenshot name`)
  return parts.join('/')
}

/** The spec file's own path, safe to use as folders: `cypress/e2e/home.cy.ts` stays as it is. */
export function specFolder(spec: string | undefined): string {
  const parts = (spec ?? '').split(/[\\/]/).filter((p) => p.length > 0 && p !== '.' && p !== '..')
  return parts.length > 0 ? parts.join('/') : 'unknown-spec'
}

/** `<dir>/<spec file>/<name>.png`, relative to the project root. */
export function capturePath(dir: string, spec: string | undefined, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${specFolder(spec)}/${captureName(name)}.png`
}
