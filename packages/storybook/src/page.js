/**
 * Functions that run inside the Storybook preview page (`page.evaluate`, `page.addInitScript`).
 * Playwright serializes each one and sends it to the browser, so none captures anything from this
 * module. Plain JavaScript with its types in page.d.ts, because they use the browser's DOM and the
 * rest of the package, which runs in Node, must not see the DOM's global types.
 */

/**
 * Runs before the story's own code: no animations, transitions or caret to catch halfway.
 * @param {string} css `STABILIZE_CSS` of `@circi/cli/names`, which can't be imported in here
 */
export function disableMotion(css) {
  const add = () => {
    const style = document.createElement('style')
    style.textContent = css
    document.documentElement.append(style)
  }
  if (document.documentElement) add()
  else document.addEventListener('DOMContentLoaded', add, { once: true })
}

/**
 * Runs before the story's own code: remembers the errors Storybook reports on its channel. A `play`
 * function that throws doesn't stop the render (the phase still ends `finished` and no error screen
 * shows), so the channel's `playFunctionThrewException` is the only place that says it failed.
 */
/* oxlint-disable no-underscore-dangle -- Storybook's own globals are named like this, and so is ours */
export function trackErrors() {
  /** @type {any} */
  const w = window
  /** @type {string[]} */
  const errors = []
  w.__circiErrors = errors
  const events = [
    'playFunctionThrewException',
    'storyThrewException',
    'storyErrored',
    'storyMissing',
  ]
  /** @param {any} preview */
  const hook = (preview) => {
    const channel = preview?.channel
    if (!channel?.on || channel.__circi) return
    channel.__circi = true
    for (const event of events) {
      channel.on(event, (/** @type {any} */ detail) => {
        errors.push(detail?.message ?? detail?.description ?? detail?.title ?? event)
      })
    }
  }
  let preview = w.__STORYBOOK_PREVIEW__
  Object.defineProperty(w, '__STORYBOOK_PREVIEW__', {
    configurable: true,
    get: () => preview,
    set: (value) => {
      preview = value
      hook(value)
    },
  })
  hook(preview)
}
/* oxlint-enable no-underscore-dangle */

/**
 * Storybook's own signal that the story is done: the preview's render phase reaches `completed`
 * (Storybook 10: `finished`) once the story rendered and its `play` function finished, or `errored`
 * / `aborted` when it threw. A `play` function's failure is only on the channel (`trackErrors`),
 * and the error screen's class on the body is the other signal. The body class `sb-show-main` is
 * the fallback for a preview that doesn't expose its render. Undefined: not yet.
 */
/* oxlint-disable no-underscore-dangle -- Storybook's own globals */
export function readRenderState() {
  const body = document.body
  if (!body) return undefined
  if (body.classList.contains('sb-show-errordisplay')) {
    const title = document.querySelector('#error-message')?.textContent?.trim()
    const stack = document.querySelector('#error-stack')?.textContent?.trim()
    return { state: 'error', message: title || stack?.split('\n')[0] || 'the story threw' }
  }
  /** @type {any} */
  const w = window
  const phase = w.__STORYBOOK_PREVIEW__?.currentRender?.phase
  const reported = w.__circiErrors?.[0]
  if (phase === 'errored' || phase === 'aborted') {
    return { state: 'error', message: reported ?? `the story ${phase}` }
  }
  if (phase === 'completed' || phase === 'finished') {
    return reported ? { state: 'error', message: reported } : { state: 'done' }
  }
  if (phase === undefined && body.classList.contains('sb-show-main')) return { state: 'done' }
  return undefined
}
/* oxlint-enable no-underscore-dangle */

/** What the story says about itself: its parameters and globals, as plain JSON. */
/* oxlint-disable no-underscore-dangle -- Storybook's own globals */
export function readStoryContext() {
  /** @type {any} */
  const w = window
  const preview = w.__STORYBOOK_PREVIEW__
  const story = preview?.currentRender?.story
  const globals = {
    ...preview?.storyStoreValue?.userGlobals?.get?.(),
    // What the story itself sets (`globals` on the story) wins over the toolbar's.
    ...story?.storyGlobals,
  }
  /** @param {unknown} value */
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- it is serialized with the function and may capture nothing
  const plain = (value) => {
    try {
      return JSON.parse(JSON.stringify(value ?? null))
    } catch {
      return null
    }
  }
  return { parameters: plain(story?.parameters), globals: plain(globals) }
}
/* oxlint-enable no-underscore-dangle */

/** Fonts, images and two frames: the page has stopped changing for reasons of its own. */
export async function settle() {
  await document.fonts.ready
  await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => undefined)))
  await new Promise((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done(undefined))),
  )
}

/**
 * The box to screenshot, in page coordinates: with a `selector` that element; otherwise the union of
 * everything visible the story rendered into its root (its elements and text, with their box
 * shadows), plus whatever it put into `document.body` outside the root (portals: menus, tooltips,
 * dialogs). The root's own box is left out: with the padded or centered layout it is wider than
 * the component.
 * @param {string | null} selector
 */
export function measureStory(selector) {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const doc = document.documentElement

  const grow = (
    /** @type {number} */ l,
    /** @type {number} */ t,
    /** @type {number} */ r,
    /** @type {number} */ b,
  ) => {
    if (r - l <= 0 || b - t <= 0) return
    left = Math.min(left, l + scrollX)
    top = Math.min(top, t + scrollY)
    right = Math.max(right, r + scrollX)
    bottom = Math.max(bottom, b + scrollY)
  }
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- it is serialized with the function and may capture nothing
  const shown = (/** @type {Element} */ el) =>
    typeof el.checkVisibility === 'function'
      ? el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      : true
  const addElement = (/** @type {Element} */ el) => {
    if (!shown(el)) return
    const rect = el.getBoundingClientRect()
    let l = rect.left
    let t = rect.top
    let r = rect.right
    let b = rect.bottom
    const shadows = getComputedStyle(el).boxShadow
    if (shadows && shadows !== 'none') {
      // `rgb(0, 0, 0) 0px 0px 10px 6px`, comma-separated: the lengths are x, y, blur, spread.
      for (const shadow of shadows.replace(/\([^)]*\)/g, '').split(',')) {
        if (/\binset\b/.test(shadow)) continue
        const [x = 0, y = 0, blur = 0, spread = 0] = (shadow.match(/-?\d*\.?\d+px/g) ?? []).map(
          Number.parseFloat,
        )
        const reach = blur + spread
        l -= Math.max(0, reach - x)
        r += Math.max(0, reach + x)
        t -= Math.max(0, reach - y)
        b += Math.max(0, reach + y)
      }
    }
    grow(l, t, r, b)
  }
  const addText = (/** @type {Node} */ node) => {
    const parent = node.parentElement
    if (!parent || !shown(parent)) return
    const range = document.createRange()
    range.selectNodeContents(node)
    const rect = range.getBoundingClientRect()
    grow(rect.left, rect.top, rect.right, rect.bottom)
  }
  const addTree = (/** @type {Element} */ tree, /** @type {boolean} */ includeSelf) => {
    if (includeSelf) addElement(tree)
    for (const el of tree.querySelectorAll('*')) addElement(el)
    const walker = document.createTreeWalker(tree, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.textContent?.trim()) addText(node)
    }
  }
  const result = (/** @type {boolean} */ missing) => ({
    box:
      right > left && bottom > top
        ? { x: left, y: top, width: right - left, height: bottom - top }
        : null,
    ...(missing ? { missing } : {}),
    pageWidth: Math.max(doc.scrollWidth, doc.clientWidth),
    pageHeight: Math.max(doc.scrollHeight, doc.clientHeight),
  })

  if (selector) {
    const el = document.querySelector(selector)
    if (!el) return result(true)
    // The element itself, not its children: an element's box is what was asked for.
    addElement(el)
    return result(false)
  }
  const root = document.querySelector('#storybook-root') ?? document.querySelector('#root')
  if (root) addTree(root, false)
  for (const child of document.body.children) {
    if (child === root) continue
    if (/^(SCRIPT|STYLE|LINK|NOSCRIPT|TEMPLATE)$/.test(child.tagName)) continue
    // Storybook's own screens (loading, errors, docs) are not the story.
    if (
      child.id.startsWith('storybook-') ||
      child.id.startsWith('error') ||
      /\bsb-/.test(child.className)
    ) {
      continue
    }
    addTree(child, child.children.length === 0)
  }
  return result(false)
}
