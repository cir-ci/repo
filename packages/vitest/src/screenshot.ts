/**
 * Browser-side steps that make a page hold still, and the deprecated `circiScreenshot` helper.
 * New tests call Vitest's `toMatchScreenshot` and add the `circi()` plugin instead.
 */

export namespace circiScreenshot {
  export interface Screenshotter {
    screenshot(options: { path: string }): Promise<unknown>
  }

  export interface Options {
    /** Where screenshots go. Default `.circi/screenshots`. */
    dir?: string
    /** Called before the picture is taken, to wait for something specific. */
    ready?: () => Promise<void> | void
    /**
     * The project root that a relative `dir` is under. Default: the root of the Vitest project
     * running the test, which is also where `CirciReporter` looks.
     */
    root?: string
  }

  /** The part of a browser document this uses (the package is built without the DOM library). */
  export interface PageDocument {
    getElementById(id: string): unknown
    createElement(tag: string): { id: string; textContent: string | null }
    head: { append(node: unknown): void }
    fonts?: { ready: Promise<unknown> }
  }
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

function currentDocument(): circiScreenshot.PageDocument {
  const found: unknown = Reflect.get(globalThis, 'document')
  if (typeof found !== 'object' || found === null) {
    throw new Error('circiScreenshot must run in the browser (Vitest browser mode)')
  }
  // The browser's own document has these members; checked structurally above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return found as circiScreenshot.PageDocument
}

/**
 * Vitest saves `screenshot({ path })` relative to the *test file*, not to the project, so the
 * reporter would never find a relative path. The path is made absolute, under the project root.
 */
async function absolutePath(dir: string, file: string, root?: string): Promise<string> {
  if (dir.startsWith('/') || /^[A-Za-z]:[\\/]/.test(dir)) return `${dir}/${file}`
  const base = root ?? (await browserProjectRoot())
  return `${base}/${dir}/${file}`
}

async function browserProjectRoot(): Promise<string> {
  const { server } = await import('vitest/browser')
  return server.config.root
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    const raf: unknown = Reflect.get(globalThis, 'requestAnimationFrame')
    if (typeof raf === 'function') raf(() => resolve())
    else setTimeout(resolve, 16)
  })

/** The browser-side steps that make a page hold still. Run inside the page. */
export async function settlePage(
  doc: circiScreenshot.PageDocument = currentDocument(),
): Promise<void> {
  if (!doc.getElementById('circi-stabilize')) {
    const style = doc.createElement('style')
    style.id = 'circi-stabilize'
    style.textContent = STABILIZE_CSS
    doc.head.append(style)
  }
  // A frame first: a font is only requested once the text that uses it has been laid out, and
  // `fonts.ready` resolves at once while nothing has been requested yet.
  await frame()
  await doc.fonts?.ready
  // Two more: layout triggered by the fonts or the style has been applied and painted.
  await frame()
  await frame()
}

let warned = false

/**
 * Takes a stabilized screenshot named `name` (e.g. `settings/profile`), saved under `dir`.
 * Returns the path it wrote, relative to the project root.
 *
 * @deprecated Use Vitest's `await expect(locator).toMatchScreenshot('name')` with the `circi()`
 * plugin from `@circi/vitest` in `vitest.config.ts`: no CirCI import in the test files. This
 * helper is removed in the next minor release.
 */
export async function circiScreenshot(
  target: circiScreenshot.Screenshotter,
  name: string,
  options: circiScreenshot.Options = {},
): Promise<string> {
  if (!warned) {
    warned = true
    console.warn(
      '[circi] circiScreenshot() is deprecated and will be removed in the next minor release: ' +
        "use `await expect(locator).toMatchScreenshot('name')` with the circi() plugin " +
        '(https://circi.dev/ci/vitest/#migrating-from-circiscreenshot)',
    )
  }
  await settlePage()
  await options.ready?.()
  const dir = options.dir ?? DEFAULT_DIR
  const file = screenshotPath(name)
  await target.screenshot({ path: await absolutePath(dir, file, options.root) })
  return `${dir}/${file}`
}
