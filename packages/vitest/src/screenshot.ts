/**
 * Taking screenshots from Vitest browser mode that stay the same between runs: motion off,
 * fonts loaded, a settled layout. Anything with `.screenshot({ path })` works as the target
 * (Vitest's `page` and its locators both do).
 */

export interface Screenshotter {
  screenshot(options: { path: string }): Promise<unknown>
}

export interface ScreenshotOptions {
  /** Where screenshots go. Default `.circi/screenshots`. */
  dir?: string
  /** Called before the picture is taken, to wait for something specific. */
  ready?: () => Promise<void> | void
}

export const DEFAULT_DIR = '.circi/screenshots'

/** CSS that stops everything that moves or blinks. */
export const STABILIZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`

/**
 * A screenshot's file name from its test name: lowercase words joined by dashes, with `/` kept
 * so related shots group into folders. Never escapes the directory.
 */
export function screenshotPath(name: string): string {
  const parts = name
    .split('/')
    .map((p) =>
      p
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^[-.]+|-+$/g, ''),
    )
    .filter((p) => p.length > 0 && p !== '..')
  if (parts.length === 0) throw new Error(`"${name}" is not a usable screenshot name`)
  return `${parts.join('/')}.png`
}

/** The part of a browser document this uses (the package is built without the DOM library). */
export interface PageDocument {
  getElementById(id: string): unknown
  createElement(tag: string): { id: string; textContent: string | null }
  head: { append(node: unknown): void }
  fonts?: { ready: Promise<unknown> }
}

function currentDocument(): PageDocument {
  const found: unknown = Reflect.get(globalThis, 'document')
  if (typeof found !== 'object' || found === null) {
    throw new Error('circiScreenshot must run in the browser (Vitest browser mode)')
  }
  // The browser's own document has these members; checked structurally above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return found as PageDocument
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    const raf: unknown = Reflect.get(globalThis, 'requestAnimationFrame')
    if (typeof raf === 'function') raf(() => resolve())
    else setTimeout(resolve, 16)
  })

/** The browser-side steps that make a page hold still. Run inside the page. */
export async function settlePage(doc: PageDocument = currentDocument()): Promise<void> {
  if (!doc.getElementById('circi-stabilize')) {
    const style = doc.createElement('style')
    style.id = 'circi-stabilize'
    style.textContent = STABILIZE_CSS
    doc.head.append(style)
  }
  await doc.fonts?.ready
  // Two frames: layout triggered by the fonts or the style has been applied and painted.
  await frame()
  await frame()
}

/**
 * Takes a stabilized screenshot named `name` (e.g. `settings/profile`), saved under `dir`.
 * Returns the path it wrote, relative to `dir`'s parent project.
 */
export async function circiScreenshot(
  target: Screenshotter,
  name: string,
  options: ScreenshotOptions = {},
): Promise<string> {
  await settlePage()
  await options.ready?.()
  const path = `${options.dir ?? DEFAULT_DIR}/${screenshotPath(name)}`
  await target.screenshot({ path })
  return path
}
