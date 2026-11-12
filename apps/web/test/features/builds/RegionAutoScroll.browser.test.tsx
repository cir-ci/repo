import type { Comment } from '@circi/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { frame, pointIn, stubPointerCapture, type Point } from '#test/support/pointer.ts'

import { detail, type FakeApi, fakeBuildApi, renderBuild } from './fake-build-api.tsx'
import { chooseDrawing } from './view-options.ts'

let capture: ReturnType<typeof stubPointerCapture>
beforeEach(async () => {
  // Short enough that the zoomed screenshot overflows the viewer both ways; wide enough (1100px
  // and up) for the viewer to sit beside the list and the sidebar, the window's height its own.
  // (The compact zoom control keeps the toolbar to two rows, so the ground is 32px taller than at
  // 400: 368 gives it the 275px these drags were tuned to.)
  await page.viewport(1200, 368)
  capture = stubPointerCapture()
})
afterEach(() => capture.mockRestore())

const NAME = 'checkout / payment'
/** The screenshot on screen after three steps of zoom in: 200% of 400 × 300. */
const WIDTH = 800
const HEIGHT = 600

const viewerTitle = () => page.getByRole('heading', { level: 2, name: NAME })
// The baseline is the left column: the build's is mostly out of sight at this width.
const build = () => page.getByRole('button', { name: /^Enlarge Baseline/ })
const marker = () => page.getByRole('button', { name: 'Comment 1' })

const asHtml = (el: Element | null): HTMLElement => {
  if (!(el instanceof HTMLElement)) throw new Error('not an element')
  return el
}
const ground = () => asHtml(document.querySelector('[data-scroll-area]'))

async function ready(setup: (api: FakeApi) => void = () => {}) {
  const api = fakeBuildApi(detail())
  api.canManage = true
  setup(api)
  await renderBuild()
  await expect.element(viewerTitle()).toBeVisible()
  const zoomIn = page.getByRole('button', { name: 'Zoom in' })
  await zoomIn.click()
  await zoomIn.click()
  await zoomIn.click()
  // The test files are not served: give the images the size they would have.
  for (const label of [/^Baseline/, /^This build/]) {
    const image = page.getByRole('img', { name: label }).element()
    image.style.width = `${WIDTH}px`
    image.style.height = `${HEIGHT}px`
  }
  await expect.poll(() => ground().scrollHeight > ground().clientHeight).toBe(true)
  await expect.poll(() => ground().scrollWidth > ground().clientWidth).toBe(true)
  return api
}

/** A pointer held on `element`: move it about, and let go when asked. */
function hold(element: Element, from: Point) {
  const fire = (type: string, at: Point) =>
    element.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: at.x,
        clientY: at.y,
      }),
    )
  fire('pointerdown', from)
  return {
    /** Render the press, as a real pointer's time before it moves would. */
    pressed: frame,
    move: async (to: Point) => {
      fire('pointermove', to)
      await frame()
    },
    up: async (at: Point) => {
      fire('pointerup', at)
      await frame()
    },
  }
}

/** A point of the ground: `dx`, `dy` from its bottom-right corner. */
const fromBottomRight = (dx: number, dy: number): Point => {
  const rect = ground().getBoundingClientRect()
  return { x: rect.right + dx, y: rect.bottom + dy }
}

const settle = async () => {
  await frame()
  await frame()
  await frame()
  await frame()
  await frame()
  await frame()
}

const pendingMarker = () => asHtml(document.querySelector('[data-pending]'))

describe('scrolling while a region is dragged', () => {
  it('scrolls the ground when a new comment region is dragged to its bottom edge, and the region grows with it', async () => {
    await ready()
    const image = build().element()
    const from = pointIn(image, 100, 60)
    const gesture = hold(image, from)
    await gesture.pressed()
    await gesture.move({ x: from.x + 40, y: from.y + 40 })
    const to = fromBottomRight(-80, -6)
    await gesture.move(to)
    await expect.poll(() => ground().scrollTop).toBeGreaterThan(60)
    await gesture.move(to)
    // What has scrolled by the time of the release: the region reaches the pointer's place in
    // the image, not where the pointer was at the press. (The comment box then takes focus,
    // which scrolls too, so the size is what to measure.)
    const scrolled = ground().scrollTop
    await gesture.up(to)
    const box = pendingMarker().getBoundingClientRect()
    expect(scrolled).toBeGreaterThan(to.y - from.y - 100)
    expect(Math.abs(box.height - (to.y + scrolled - from.y))).toBeLessThan(2)
    expect(box.height).toBeGreaterThan(to.y - from.y + 60)
  })

  it('scrolls sideways to the right edge too', async () => {
    await ready()
    const image = build().element()
    const from = pointIn(image, 100, 60)
    const gesture = hold(image, from)
    await gesture.pressed()
    const to = fromBottomRight(-4, -200)
    await gesture.move(to)
    await expect.poll(() => ground().scrollLeft).toBeGreaterThan(40)
    const scrolled = ground().scrollLeft
    await gesture.up(to)
    const box = pendingMarker().getBoundingClientRect()
    expect(Math.abs(box.width - (to.x + scrolled - from.x))).toBeLessThan(2)
  })

  it('scrolls past the edge too, faster the further out the pointer is', async () => {
    await ready()
    const image = build().element()
    const from = pointIn(image, 100, 60)
    const gesture = hold(image, from)
    await gesture.pressed()
    await gesture.move(fromBottomRight(-80, 60))
    const before = ground().scrollTop
    await settle()
    const pastRate = (ground().scrollTop - before) / 6
    await gesture.up(fromBottomRight(-80, 60))
    expect(pastRate).toBeGreaterThan(8)
  })

  it('keeps ignore regions following the pointer the same way, and posts the scrolled area', async () => {
    const api = await ready()
    await chooseDrawing('Ignore regions')
    const image = build().element()
    const from = pointIn(image, 100, 60)
    const gesture = hold(image, from)
    await gesture.pressed()
    const to = fromBottomRight(-80, -6)
    await gesture.move(to)
    await expect.poll(() => ground().scrollTop).toBeGreaterThan(60)
    const scrolled = ground().scrollTop
    await gesture.up(to)
    await vi.waitFor(() => expect(api.ignorePosts).toHaveLength(1))
    const posted = api.ignorePosts[0]
    // On screen the image is 800 × 600 for its 400 × 300 pixels: a half.
    const imageBox = image.getBoundingClientRect()
    const expectedBottom = (to.y - imageBox.top) / 2
    expect(Math.abs((posted?.y ?? 0) + (posted?.height ?? 0) - expectedBottom)).toBeLessThan(
      Math.max(4, scrolled * 0.05),
    )
  })

  it('stops scrolling when the pointer is released', async () => {
    await ready()
    const image = build().element()
    const from = pointIn(image, 100, 60)
    const gesture = hold(image, from)
    await gesture.pressed()
    const to = fromBottomRight(-80, -6)
    await gesture.move(to)
    await expect.poll(() => ground().scrollTop).toBeGreaterThan(30)
    await gesture.up(to)
    const after = ground().scrollTop
    await settle()
    await settle()
    expect(ground().scrollTop).toBe(after)
  })

  it('stops scrolling when the pointer is cancelled', async () => {
    await ready()
    const image = build().element()
    const gesture = hold(image, pointIn(image, 100, 60))
    await gesture.pressed()
    await gesture.move(fromBottomRight(-80, -6))
    await expect.poll(() => ground().scrollTop).toBeGreaterThan(30)
    image.dispatchEvent(
      new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' }),
    )
    await frame()
    const after = ground().scrollTop
    await settle()
    expect(ground().scrollTop).toBe(after)
  })

  it('does not scroll while the pointer stays in the middle', async () => {
    await ready()
    const image = build().element()
    const from = pointIn(image, 100, 60)
    const gesture = hold(image, from)
    await gesture.pressed()
    await gesture.move({ x: from.x + 60, y: from.y + 60 })
    await settle()
    expect(ground().scrollTop).toBe(0)
    expect(ground().scrollLeft).toBe(0)
    await gesture.up({ x: from.x + 60, y: from.y + 60 })
  })
})

describe('scrolling while a region is moved or resized', () => {
  const REGION: Comment.Region = { x: 0.1, y: 0.1, width: 0.15, height: 0.15 }
  const comment = (): Comment.Item => ({
    id: 'c1',
    parentId: null,
    snapshotName: NAME,
    region: REGION,
    regionSide: 'baseline',
    body: 'Looks off',
    author: { id: 'u1', name: 'Ada Lovelace', image: null },
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    mine: true,
    canDelete: true,
  })

  it('scrolls when a region is moved to the bottom edge, and saves where it was dropped', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    const host = marker().element()
    const box = host.getBoundingClientRect()
    const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const gesture = hold(host, from)
    await gesture.pressed()
    const to = { x: from.x, y: fromBottomRight(0, -6).y }
    await gesture.move({ x: from.x, y: from.y + 40 })
    await gesture.move({ x: from.x, y: to.y })
    await expect.poll(() => ground().scrollTop).toBeGreaterThan(60)
    const scrolled = ground().scrollTop
    await gesture.up({ x: from.x, y: to.y })
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    const saved = api.regionPatches[0]
    // The top moved by the pointer's travel plus what scrolled, as a fraction of the 600px image.
    const travelled = to.y - from.y + scrolled
    expect(Math.abs((saved?.y ?? 0) * HEIGHT - (REGION.y * HEIGHT + travelled))).toBeLessThan(
      Math.max(6, scrolled * 0.05),
    )
    expect(saved?.height).toBeCloseTo(REGION.height, 4)
  })

  it('scrolls when a corner is resized past the edge', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    const handle = asHtml(marker().element().querySelector('[data-corner="se"]'))
    const box = handle.getBoundingClientRect()
    const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    const gesture = hold(handle, from)
    await gesture.pressed()
    const to = { x: from.x, y: fromBottomRight(0, 30).y }
    await gesture.move({ x: from.x, y: from.y + 30 })
    await gesture.move({ x: from.x, y: to.y })
    await expect.poll(() => ground().scrollTop).toBeGreaterThan(30)
    await gesture.up({ x: from.x, y: to.y })
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    const saved = api.regionPatches[0]
    expect(saved?.height ?? 0).toBeGreaterThan(REGION.height + 0.1)
    expect(saved?.y).toBeCloseTo(REGION.y, 4)
  })
})
