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

/** Where captures go unless told otherwise, relative to the project root. */
export const DEFAULT_DIR = '.circi/screenshots'

/**
 * The folder a tool owns inside the captures' folder: `.circi/screenshots/vitest`,
 * `.circi/screenshots/storybook`, `.circi/screenshots/cypress`. `dir` is the parent, the same for
 * every tool (`options.dir ?? DEFAULT_DIR`); a tool writes, cleans and uploads only its own
 * folder, so two tools in one project never upload or delete each other's captures. Names in CirCI
 * are relative to the tool's folder, so they don't carry the tool's name.
 */
export function toolDir(dir: string, tool: string): string {
  return `${dir.replace(/\/+$/, '')}/${tool}`
}

/** CSS that stops everything that moves or blinks, so a screenshot doesn't catch a frame halfway. */
export const STABILIZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`
