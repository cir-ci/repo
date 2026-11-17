/**
 * Where a capture goes, and what CirCI calls it. Pure string work, shared by the browser-side
 * matcher and the tests; it imports nothing, so a browser bundle can load it.
 */

/** Vitest's own rule for a screenshot name: words kept, whitespace to dashes, the rest dropped. */
function sanitize(input: string): string {
  return input
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/-{2,}/g, '-')
}

/**
 * A screenshot's file name from the `name` given to `toMatchScreenshot`, or from the generated
 * `<describe> > <test> <n>` when none was given. The same rule Vitest applies to its own
 * references, so a name means the same file in both: `/` keeps folders, nothing escapes upward.
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

/**
 * The path of a capture relative to the project root: `<dir>/<test file>/<name>.png`, with the test
 * file relative to the root too, so two tests with the same screenshot name never share a file.
 */
export function capturePath(dir: string, testFile: string, name: string): string {
  const file = testFile
    .split(/[\\/]/)
    .filter((part) => part.length > 0 && part !== '.' && part !== '..')
    .join('/')
  return `${dir.replace(/\/+$/, '')}/${file}/${captureName(name)}.png`
}
