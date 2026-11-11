import type { Comment } from '@circi/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

vi.mock('#lib/auth-client.ts', () =>
  import('#test/support/auth-client.ts').then((m) => m.authClientModule),
)

import { centerOf, pointerDrag, pointIn, stubPointerCapture } from '#test/support/pointer.ts'

import { detail, type FakeApi, fakeBuildApi, renderBuild } from './fake-build-api.tsx'

let capture: ReturnType<typeof stubPointerCapture>
beforeEach(async () => {
  await page.viewport(1400, 900)
  capture = stubPointerCapture()
})
afterEach(() => capture.mockRestore())

const NAME = 'checkout / payment'
/** The comment's region: 100, 75 to 300, 225 on the 400 × 300 image. */
const REGION: Comment.Region = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }

const viewerTitle = () => page.getByRole('heading', { level: 2, name: NAME })
const popover = () => page.getByRole('dialog', { name: 'Comment on this region' })
const trigger = (name: 'Baseline' | 'This build') =>
  page.getByRole('button', { name: new RegExp(`^Enlarge ${name}`) })
const marker = () => page.getByRole('button', { name: 'Comment 1' })
const toggle = () => page.getByRole('group', { name: 'Dragging draws' })
const enlarged = () => page.getByRole('dialog', { name: 'Baseline · #6 on main' })
const overlay = () => page.getByTestId('region-overlay')

const comment = (overrides: Partial<Comment.Item> = {}): Comment.Item => ({
  id: 'c1',
  parentId: null,
  snapshotName: NAME,
  region: REGION,
  regionSide: 'current',
  body: 'Looks off',
  author: { id: 'u1', name: 'Ada Lovelace', image: null },
  createdAt: new Date().toISOString(),
  editedAt: null,
  deletedAt: null,
  mine: true,
  canDelete: true,
  ...overrides,
})

async function ready(setup: (api: FakeApi) => void = () => {}) {
  const api = fakeBuildApi(detail())
  setup(api)
  await renderBuild()
  await expect.element(viewerTitle()).toBeVisible()
  // The test files are not served: give the images the size they would have.
  for (const label of [/^Baseline/, /^This build/]) {
    const image = page.getByRole('img', { name: label }).element()
    image.style.width = '400px'
    image.style.height = '300px'
  }
  return api
}

const CORNERS = ['nw', 'ne', 'sw', 'se']

const handleOf = (host: Element, corner: string) => {
  const handle = host.querySelector(`[data-corner="${corner}"]`)
  if (!handle) throw new Error(`no ${corner} handle`)
  return handle
}

/** The image the regions are fractions of: where a drag's points are measured from. */
// (Looked up by label: the page behind the open comment box is out of the accessibility tree.)
const imageEl = () => page.getByLabelText(/^Enlarge This build/).element()

/** A point of the image given as fractions of it (the page may show it at any size). */
function onImage(image: Element, fx: number, fy: number) {
  const { width, height } = image.getBoundingClientRect()
  return pointIn(image, fx * width, fy * height)
}

/** Drag a corner handle of the host element to a point of the image, given as fractions of it. */
function dragCorner(
  host: Element,
  corner: string,
  to: { x: number; y: number },
  image = imageEl(),
) {
  const handle = handleOf(host, corner)
  return pointerDrag(handle, centerOf(handle), onImage(image, to.x, to.y))
}

/** Drag the body of the host element, from its middle, by fractions of the image. */
function dragBody(host: Element, dx: number, dy: number, image = imageEl()) {
  const from = centerOf(host)
  const { width, height } = image.getBoundingClientRect()
  return pointerDrag(host, from, { x: from.x + dx * width, y: from.y + dy * height })
}

const near = (actual: number | undefined, expected: number) =>
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThan(0.012)

const lastPatch = (api: FakeApi) => api.regionPatches.at(-1)

describe('adjusting a comment region you wrote', () => {
  it('shows the move cursor on the body and the matching resize cursor on each corner', async () => {
    await ready((api) => api.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    const host = marker().element()
    expect(host).toHaveAttribute('data-adjustable')
    expect(getComputedStyle(host).cursor).toBe('move')
    expect(CORNERS.map((c) => getComputedStyle(handleOf(host, c)).cursor)).toEqual([
      'nwse-resize',
      'nesw-resize',
      'nesw-resize',
      'nwse-resize',
    ])
    // Handles are a pointer affordance only: hidden from assistive technology.
    for (const corner of CORNERS) {
      expect(handleOf(host, corner)).toHaveAttribute('aria-hidden', 'true')
    }
    await expect.element(marker()).toHaveAccessibleName('Comment 1')
  })

  it('shows the handles while the region is hovered, and not otherwise', async () => {
    await ready((api) => api.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    const dot = () => getComputedStyle(handleOf(marker().element(), 'se'), '::after').opacity
    await userEvent.unhover(marker())
    await expect.poll(() => dot()).toBe('0')
    await userEvent.hover(marker(), { position: { x: 100, y: 75 } })
    await vi.waitFor(() => expect(dot()).toBe('1'))
  })

  it.each([
    ['nw', { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.2, width: 0.55, height: 0.55 }],
    ['ne', { x: 0.8, y: 0.2 }, { x: 0.25, y: 0.2, width: 0.55, height: 0.55 }],
    ['sw', { x: 0.2, y: 0.8 }, { x: 0.2, y: 0.25, width: 0.55, height: 0.55 }],
    ['se', { x: 0.8, y: 0.8 }, { x: 0.25, y: 0.25, width: 0.55, height: 0.55 }],
  ])(
    'resizes from the %s corner and saves, the opposite corner staying put',
    async (corner, to, expected) => {
      const api = await ready((a) => a.comments.push(comment()))
      await expect.element(marker()).toBeVisible()
      await dragCorner(marker().element(), corner, to)
      await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
      const saved = lastPatch(api)
      expect(saved?.id).toBe('c1')
      near(saved?.x, expected.x)
      near(saved?.y, expected.y)
      near(saved?.width, expected.width)
      near(saved?.height, expected.height)
      await expect.element(page.getByText('Region saved')).toBeInTheDocument()
    },
  )

  it('moves by the body and keeps the size', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    await dragBody(marker().element(), 0.1, 0.1)
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    near(lastPatch(api)?.x, 0.35)
    near(lastPatch(api)?.y, 0.35)
    expect(lastPatch(api)?.width).toBeCloseTo(0.5, 6)
    expect(lastPatch(api)?.height).toBeCloseTo(0.5, 6)
    // The marker follows the saved region.
    await vi.waitFor(() => expect(marker().element().style.left).toMatch(/^3[45]/))
  })

  it('never shows the old region again after the release, even while the save is slow', async () => {
    const api = await ready((a) => {
      a.comments.push(comment())
      a.regionDelayMs = 400
    })
    await expect.element(marker()).toBeVisible()
    const host = marker().element()
    // Every render of the region's position, in order.
    const lefts: string[] = [host.style.left]
    const watch = new MutationObserver(() => lefts.push(host.style.left))
    watch.observe(host, { attributes: true, attributeFilter: ['style'] })
    await dragBody(host, 0.1, 0.1)
    // The save's answer is still to come: the region sits where it was dropped.
    expect(host.style.left).toMatch(/^3[45]/)
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    await vi.waitFor(() => expect(host.style.left).toMatch(/^3[45]/))
    await new Promise((resolve) => setTimeout(resolve, 600))
    watch.disconnect()
    const moved = lefts.findIndex((left) => left !== '25%')
    expect(moved).toBeGreaterThan(-1)
    expect(lefts.slice(moved)).not.toContain('25%')
  })

  it('stops at the image edges when moving or resizing', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    await dragBody(marker().element(), 5, 5)
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    expect(lastPatch(api)).toMatchObject({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 })

    await dragCorner(marker().element(), 'nw', { x: -1, y: -1 })
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(2))
    expect(lastPatch(api)).toMatchObject({ x: 0, y: 0, width: 1, height: 1 })
  })

  it('keeps a minimum size of 8 screen pixels, and never flips over the opposite corner', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    await dragCorner(marker().element(), 'se', { x: 0, y: 0 })
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    expect(lastPatch(api)?.x).toBeCloseTo(0.25, 6)
    expect(lastPatch(api)?.y).toBeCloseTo(0.25, 6)
    near(lastPatch(api)?.width, 8 / imageEl().getBoundingClientRect().width)
    near(lastPatch(api)?.height, 8 / imageEl().getBoundingClientRect().height)
  })

  it('Esc during a drag puts the region back and saves nothing', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await expect.element(marker()).toBeVisible()
    const host = marker().element()
    const handle = handleOf(host, 'se')
    const from = centerOf(handle)
    // The button stays down mid-drag: the release comes after Esc.
    await pointerDrag(handle, from, { x: from.x + 40, y: from.y + 30 }, { release: false })
    await vi.waitFor(() => expect(host.style.width).not.toBe('50%'))
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() => expect(host.style.width).toBe('50%'))
    expect(host.style.height).toBe('50%')
    handle.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: from.x + 40,
        clientY: from.y + 30,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(api.regionPatches).toEqual([])
    expect(host.style.width).toBe('50%')
  })

  it('a click without moving still brings the comment into focus and saves nothing', async () => {
    const api = await ready((a) => a.comments.push(comment()))
    await marker().click()
    await expect
      .element(page.getByRole('tab', { name: /^Comments/ }))
      .toHaveAttribute('aria-selected', 'true')
    expect(api.regionPatches).toEqual([])
  })

  it('puts the region back and says why when saving fails', async () => {
    const api = await ready((a) => {
      a.comments.push(comment())
      a.regionError = 'The region is too small'
    })
    await expect.element(marker()).toBeVisible()
    await dragCorner(marker().element(), 'se', { x: 0.8, y: 0.8 })
    await expect.element(page.getByText('The region is too small')).toBeVisible()
    await vi.waitFor(() => expect(marker().element().style.width).toBe('50%'))
    expect(api.regionPatches).toEqual([])
  })

  it('works on the enlarged image', async () => {
    const api = await ready((a) => a.comments.push(comment({ regionSide: 'baseline' })))
    // The comment covers the middle of the image: press its corner.
    await trigger('Baseline').click({ position: { x: 10, y: 10 } })
    await expect.element(enlarged()).toBeVisible()
    const image = enlarged().getByRole('img').element()
    image.style.width = '400px'
    image.style.height = '300px'
    const inDialog = enlarged().getByRole('button', { name: 'Comment 1' })
    await expect.element(inDialog).toBeVisible()
    await dragBody(inDialog.element(), 0.1, 0.1, overlay().element())
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(1))
    near(lastPatch(api)?.x, 0.35)
    near(lastPatch(api)?.y, 0.35)
    // The dialog stays open, and a corner works there too.
    await expect.element(enlarged()).toBeVisible()
    await dragCorner(inDialog.element(), 'se', { x: 0.99, y: 0.99 }, overlay().element())
    await vi.waitFor(() => expect(api.regionPatches).toHaveLength(2))
    near((lastPatch(api)?.x ?? 0) + (lastPatch(api)?.width ?? 0), 0.99)
  })
})

describe("other people's comment regions", () => {
  it('have no handles and no move cursor', async () => {
    await ready((api) =>
      api.comments.push(comment({ mine: false, author: { id: 'u2', name: 'Dana', image: null } })),
    )
    await expect.element(marker()).toBeVisible()
    const host = marker().element()
    expect(host).not.toHaveAttribute('data-adjustable')
    expect(host.querySelectorAll('[data-corner]')).toHaveLength(0)
    expect(getComputedStyle(host).cursor).toBe('pointer')
  })
})

describe('the comment region drawn and not yet sent', () => {
  it('can be moved and resized before Send; the box follows and keeps its text', async () => {
    const api = await ready()
    await userEvent.dragAndDrop(trigger('This build'), trigger('This build'), {
      sourcePosition: { x: 40, y: 30 },
      targetPosition: { x: 200, y: 150 },
    })
    await expect.element(popover()).toBeVisible()
    await userEvent.keyboard('Spacing is off')
    const draft = document.querySelector<HTMLElement>('[data-pending][data-adjustable]')
    if (!draft) throw new Error('no draft region')
    expect(getComputedStyle(draft).cursor).toBe('move')

    // Move it by a tenth of the image each way, then pull its bottom-right corner out to 65%, 63%.
    await dragBody(draft, 0.1, 0.1)
    await vi.waitFor(() => expect(draft.style.left).toMatch(/^2[01]/))
    await dragCorner(draft, 'se', { x: 0.65, y: 0.63 })
    await vi.waitFor(() => expect(draft.style.width).toMatch(/^4[4-9]|^5/))

    await expect
      .element(popover().getByRole('textbox', { name: 'Comment' }))
      .toHaveValue('Spacing is off')
    await popover().getByRole('button', { name: /^Send/ }).click()
    await vi.waitFor(() => expect(api.commentPosts).toHaveLength(1))
    const region = api.commentPosts[0]?.region
    near(region?.x, 0.2)
    near(region?.y, 0.2)
    near((region?.x ?? 0) + (region?.width ?? 0), 0.65)
    near((region?.y ?? 0) + (region?.height ?? 0), 0.63)
    // It is saved with the comment, not through the region route.
    expect(api.regionPatches).toEqual([])
  })
})

const ignoreSetup = (api: FakeApi) => {
  api.canManage = true
  api.ignoreRegions = [
    {
      id: 'r1',
      name: NAME,
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      createdAt: new Date().toISOString(),
      createdBy: { id: 'u2', name: 'Dana Levi' },
    },
  ]
}
/** The regions show over both images; this is the one on this build's. */
const buildBox = () => {
  const boxes = [...document.querySelectorAll<HTMLElement>('[data-adjustable]')]
  const last = boxes.at(-1)
  if (!last) throw new Error('no adjustable ignore region')
  return last
}

const within = (actual: number | undefined, expected: number, pixels: number) =>
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(pixels)

async function ignoring(setup: (api: FakeApi) => void = ignoreSetup) {
  const api = await ready(setup)
  await toggle().getByRole('button', { name: 'Ignore regions' }).click()
  await vi.waitFor(() => expect(document.querySelectorAll('[data-adjustable]')).toHaveLength(2))
  return api
}

describe('adjusting ignore regions on the build page', () => {
  it('moves one by its body, saving pixels of the screenshot with the size unchanged', async () => {
    const api = await ignoring()
    expect(getComputedStyle(buildBox()).cursor).toBe('move')
    // 50 × 40 pixels of the 400 × 300 screenshot.
    await dragBody(buildBox(), 50 / 400, 40 / 300)
    await vi.waitFor(() => expect(api.ignorePatches).toHaveLength(1))
    const [patch] = api.ignorePatches
    expect(patch?.id).toBe('r1')
    within(patch?.x, 60, 2)
    within(patch?.y, 60, 2)
    expect(patch?.width).toBe(100)
    expect(patch?.height).toBe(50)
    await expect.element(page.getByText('Ignore region saved')).toBeInTheDocument()
    // Nothing new was drawn.
    expect(api.ignorePosts).toEqual([])
  })

  it('resizes from a corner', async () => {
    const api = await ignoring()
    // The bottom-right corner is at 110, 70 of the 400 × 300 screenshot: pull it to 150, 100.
    await dragCorner(buildBox(), 'se', { x: 150 / 400, y: 100 / 300 })
    await vi.waitFor(() => expect(api.ignorePatches).toHaveLength(1))
    const [patch] = api.ignorePatches
    within(patch?.x, 10, 1)
    within(patch?.y, 20, 1)
    within(patch?.width, 140, 3)
    within(patch?.height, 80, 3)
  })

  it('goes back to the saved rectangle and shows the error when saving fails', async () => {
    const api = await ignoring((a) => {
      ignoreSetup(a)
      a.regionError = 'Region is outside the screenshot'
    })
    await dragCorner(buildBox(), 'se', { x: 150 / 400, y: 100 / 300 })
    await expect.element(page.getByText('Region is outside the screenshot')).toBeVisible()
    await vi.waitFor(() => expect(buildBox().style.width).toBe('25%'))
    expect(api.ignorePatches).toEqual([])
  })

  it('a press that does not move one still enlarges the image, and a drag on empty image draws', async () => {
    const api = await ignoring()
    await userEvent.dragAndDrop(trigger('This build'), trigger('This build'), {
      sourcePosition: { x: 200, y: 150 },
      targetPosition: { x: 300, y: 250 },
    })
    await vi.waitFor(() => expect(api.ignorePosts).toHaveLength(1))
    expect(api.ignorePatches).toEqual([])
    const box = buildBox()
    await pointerDrag(box, centerOf(box), centerOf(box))
    await expect.element(page.getByRole('dialog', { name: /^This build/ })).toBeVisible()
    expect(api.ignorePatches).toEqual([])
  })
})
