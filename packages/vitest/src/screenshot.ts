/**
 * Browser-side steps that make a page hold still before `toMatchScreenshot` takes its picture,
 * and where the captures go.
 */

export namespace settlePage {
  /** The part of a browser document this uses (the package is built without the DOM library). */
  export interface Document {
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

function currentDocument(): settlePage.Document {
  const found: unknown = Reflect.get(globalThis, 'document')
  if (typeof found !== 'object' || found === null) {
    throw new Error('settlePage must run in the browser (Vitest browser mode)')
  }
  // The browser's own document has these members; checked structurally above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return found as settlePage.Document
}

const frame = (): Promise<void> =>
  new Promise((resolve) => {
    const raf: unknown = Reflect.get(globalThis, 'requestAnimationFrame')
    if (typeof raf === 'function') raf(() => resolve())
    else setTimeout(resolve, 16)
  })

/** The browser-side steps that make a page hold still. Run inside the page. */
export async function settlePage(doc: settlePage.Document = currentDocument()): Promise<void> {
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
