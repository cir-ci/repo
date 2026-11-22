/**
 * Browser-side steps behind `cy.screenshot()`: make the page hold still, and decide what the
 * picture is of so that it holds the thing and nothing around it. Runs inside the page, so it uses
 * the DOM; Node never imports it.
 */

export const STABILIZE_ID = 'circi-stabilize'

/** CSS that stops what blinks or moves (Cypress's own option covers animations and timers too). */
export const STABILIZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
`

const frame = (win: Window): Promise<void> =>
  new Promise((r) => win.requestAnimationFrame(() => r()))

/** Add the stabilizing style, then wait for fonts and two painted frames. */
export async function settle(win: Window): Promise<void> {
  const doc = win.document
  if (!doc.getElementById(STABILIZE_ID)) {
    const style = doc.createElement('style')
    style.id = STABILIZE_ID
    style.textContent = STABILIZE_CSS
    doc.head.append(style)
  }
  // A frame first: a font is only requested once text that uses it has been laid out, and
  // `fonts.ready` resolves at once while nothing has been requested yet.
  await frame(win)
  await doc.fonts.ready
  await frame(win)
  await frame(win)
}

export function unsettle(win: Window): void {
  win.document.getElementById(STABILIZE_ID)?.remove()
}

function describe(el: Element): string {
  const id = el.id ? `#${el.id}` : ''
  const cls = el.classList.length > 0 ? `.${[...el.classList].join('.')}` : ''
  return `<${el.tagName.toLowerCase()}${id}${cls}>`
}

/** An element with a box and not hidden: otherwise there is nothing to take a picture of. */
export function assertCapturable(el: Element, what = describe(el)): void {
  const box = el.getBoundingClientRect()
  const shown = typeof el.checkVisibility === 'function' ? el.checkVisibility() : true
  if (box.width <= 0 || box.height <= 0 || !shown) {
    throw new Error(
      `cy.screenshot(): nothing to capture, ${what} has no size or isn't visible. ` +
        'Wait for it to render before taking the screenshot.',
    )
  }
}

/** What to photograph when `cy.screenshot()` is called on the page. */
export interface PageTarget {
  /** A page: capture it at this size, from the top. */
  clip?: { x: number; y: number; width: number; height: number }
  /** Component testing: the mounted component itself. */
  element?: Element
}

/** The bottom of everything on the page, in page coordinates: where its content ends. */
export function contentBottom(win: Window): number {
  const doc = win.document
  const body = doc.body
  let bottom = 0
  const range = doc.createRange()
  range.selectNodeContents(body)
  const own = range.getBoundingClientRect()
  if (own.width > 0 || own.height > 0) bottom = own.bottom
  for (const el of body.querySelectorAll('*')) {
    const box = el.getBoundingClientRect()
    if (box.width > 0 && box.height > 0 && el.checkVisibility())
      bottom = Math.max(bottom, box.bottom)
  }
  return Math.ceil(bottom + win.scrollY)
}

/** The padding below the content that the caller asked for (the `bottom` of Cypress's `padding`). */
export function bottomPadding(padding: unknown): number {
  if (typeof padding === 'number') return padding
  if (Array.isArray(padding)) {
    const bottom: unknown = padding.length === 2 ? padding[0] : padding[2]
    return typeof bottom === 'number' ? bottom : 0
  }
  return 0
}

/** Decide what a `cy.screenshot()` without a subject photographs. */
export function pageTarget(win: Window, testingType: string, padding: unknown): PageTarget {
  const doc = win.document
  if (testingType === 'component') {
    const root = doc.querySelector('[data-cy-root]')
    if (!root) throw new Error('cy.screenshot(): nothing to capture, no component is mounted')
    // The component's own box: the one element the root renders, or the root if there are several.
    const target = root.children.length === 1 ? (root.children[0] ?? root) : root
    assertCapturable(
      target,
      root.children.length === 1 ? 'the mounted component' : 'the mount point',
    )
    return { element: target }
  }
  const content = contentBottom(win)
  if (content <= 0) throw new Error('cy.screenshot(): nothing to capture, the page has no content')
  return {
    clip: {
      x: 0,
      y: 0,
      width: doc.documentElement.clientWidth,
      height: content + bottomPadding(padding),
    },
  }
}
