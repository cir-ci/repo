import type { IgnoreRegion } from '@circi/api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { IgnoreRegionsEditor } from '#features/regions/IgnoreRegionsEditor.tsx'
import { deferred, fakeApi } from '#test/support/fetch.ts'
import { centerOf, pointerDrag, pointIn, stubPointerCapture } from '#test/support/pointer.ts'
import { renderPage } from '#test/support/render.tsx'

const API = '/api/projects/acme/web'
const NAME = 'checkout/summary'
/** The screenshot is 1000 × 500 pixels, shown at 500 × 250: one screen pixel is two of its own. */
const LATEST = { buildNumber: 148, sha256: 'sha', width: 1000, height: 500 }

let capture: ReturnType<typeof stubPointerCapture>
beforeEach(() => {
  capture = stubPointerCapture()
})
afterEach(() => capture.mockRestore())

const region = (overrides: Partial<IgnoreRegion.Item> = {}): IgnoreRegion.Item => ({
  id: 'r1',
  name: NAME,
  x: 100,
  y: 50,
  width: 200,
  height: 100,
  createdAt: '2026-11-01T00:00:00.000Z',
  createdBy: { id: 'u2', name: 'Dana Levi' },
  ...overrides,
})

/** `hold` keeps the save's answer back until it settles: a slow network, with no timer. */
async function show(canManage: boolean, failWith?: string, hold?: Promise<unknown>) {
  let regions = [region()]
  const patches: { id: string; body: Record<string, number> }[] = []
  fakeApi({
    [`GET ${API}/ignore-regions`]: () => ({ body: { regions, snapshots: [] } }),
    [`PATCH ${API}/ignore-regions/r1`]: (body) => {
      if (failWith) return { status: 400, body: { error: failWith } }
      const rect: Record<string, number> =
        typeof body === 'object' && body
          ? Object.fromEntries(Object.entries(body).map(([key, value]) => [key, Number(value)]))
          : {}
      patches.push({ id: 'r1', body: rect })
      regions = regions.map((r) => ({ ...r, ...rect }))
      return { body: regions[0], holdUntil: hold }
    },
  })
  await renderPage(
    <IgnoreRegionsEditor
      workspace="acme"
      project="web"
      name={NAME}
      latest={LATEST}
      defaultBranch="main"
      canManage={canManage}
    />,
    { announcer: true },
  )
  const image = page.getByRole('img', { name: `${NAME} in build #148` })
  await expect.element(image).toBeVisible()
  // The test files are not served: give the image the size it would have.
  const shot = image.element().closest<HTMLElement>('[data-annotatable]')
  if (shot) shot.style.width = '500px'
  image.element().style.height = '250px'
  return { patches, image }
}

const boxes = () => [...document.querySelectorAll<HTMLElement>('[data-adjustable]')]
const box = () => {
  const [first] = boxes()
  if (!first) throw new Error('no adjustable region')
  return first
}
const corner = (host: Element, name: string) => {
  const handle = host.querySelector(`[data-corner="${name}"]`)
  if (!handle) throw new Error(`no ${name} handle`)
  return handle
}

describe('adjusting ignore regions on the baseline page', () => {
  it('moves a region by dragging its body; the saved pixels follow the zoom and keep the size', async () => {
    const { patches } = await show(true)
    await vi.waitFor(() => expect(boxes()).toHaveLength(1))
    expect(getComputedStyle(box()).cursor).toBe('move')
    // 30 × 20 screen pixels are 60 × 40 pixels of the screenshot.
    const from = centerOf(box())
    await pointerDrag(box(), from, { x: from.x + 30, y: from.y + 20 })
    await vi.waitFor(() => expect(patches).toHaveLength(1))
    const rect = patches[0]?.body
    expect(Math.abs((rect?.x ?? 0) - 160)).toBeLessThanOrEqual(2)
    expect(Math.abs((rect?.y ?? 0) - 90)).toBeLessThanOrEqual(2)
    expect(rect?.width).toBe(200)
    expect(rect?.height).toBe(100)
    await expect.element(page.getByText('Ignore region saved')).toBeInTheDocument()
    // The list shows the saved rectangle.
    await expect.element(page.getByText(/^200 x 100 at 1[56]\d, [89]\d$/)).toBeVisible()
  })

  it('never shows the old region again after the release, even while the save is slow', async () => {
    const slow = deferred()
    const { patches } = await show(true, undefined, slow.promise)
    await vi.waitFor(() => expect(boxes()).toHaveLength(1))
    const host = box()
    expect(host.style.left).toBe('10%')
    // Every render of the region's position, in order.
    const lefts: string[] = [host.style.left]
    const watch = new MutationObserver(() => lefts.push(host.style.left))
    watch.observe(host, { attributes: true, attributeFilter: ['style'] })
    const from = centerOf(host)
    await pointerDrag(host, from, { x: from.x + 30, y: from.y + 20 })
    // Released, and the save is not answered yet: the region is where it was dropped.
    expect(host.style.left).not.toBe('10%')
    await vi.waitFor(() => expect(patches).toHaveLength(1))
    // The save answers now: the saved region replaces the dropped one without a flash of the old.
    slow.resolve()
    await expect.element(page.getByText('Ignore region saved')).toBeInTheDocument()
    await expect.poll(() => host.style.left).not.toBe('10%')
    watch.disconnect()
    const moved = lefts.findIndex((left) => left !== '10%')
    expect(moved).toBeGreaterThan(-1)
    expect(lefts.slice(moved)).not.toContain('10%')
  })

  it('resizes from each corner kind, the opposite corner staying put', async () => {
    const { patches, image } = await show(true)
    await vi.waitFor(() => expect(boxes()).toHaveLength(1))
    const host = box()
    expect(getComputedStyle(corner(host, 'nw')).cursor).toBe('nwse-resize')
    expect(getComputedStyle(corner(host, 'ne')).cursor).toBe('nesw-resize')
    // Top-left from (50, 25) to (30, 15) on screen: the region grows 40 × 20 pixels up and left.
    const nw = corner(host, 'nw')
    await pointerDrag(nw, centerOf(nw), pointIn(image.element(), 30, 15))
    await vi.waitFor(() => expect(patches).toHaveLength(1))
    const rect = patches[0]?.body
    expect(Math.abs((rect?.x ?? 0) - 60)).toBeLessThanOrEqual(6)
    expect(Math.abs((rect?.y ?? 0) - 30)).toBeLessThanOrEqual(6)
    // The bottom-right corner stayed at 300, 150.
    expect(Math.abs((rect?.x ?? 0) + (rect?.width ?? 0) - 300)).toBeLessThanOrEqual(2)
    expect(Math.abs((rect?.y ?? 0) + (rect?.height ?? 0) - 150)).toBeLessThanOrEqual(2)
  })

  it('puts the region back and shows why when saving fails', async () => {
    const { patches } = await show(true, 'The region must fit inside the screenshot')
    await vi.waitFor(() => expect(boxes()).toHaveLength(1))
    const host = box()
    const from = centerOf(host)
    await pointerDrag(host, from, { x: from.x + 30, y: from.y + 20 })
    await expect.element(page.getByText('The region must fit inside the screenshot')).toBeVisible()
    await vi.waitFor(() => expect(host.style.left).toBe('10%'))
    expect(patches).toEqual([])
  })

  it('works on the enlarged image too', async () => {
    const { patches } = await show(true)
    await vi.waitFor(() => expect(boxes()).toHaveLength(1))
    // Press the image away from the region to enlarge it.
    await page
      .getByRole('button', { name: `Enlarge ${NAME}` })
      .click({ position: { x: 480, y: 230 } })
    const dialog = page.getByRole('dialog', { name: new RegExp(NAME) })
    await expect.element(dialog).toBeVisible()
    const inDialog = dialog.element().querySelector<HTMLElement>('[data-adjustable]')
    if (!inDialog) throw new Error('no region in the dialog')
    const from = centerOf(inDialog)
    const overlay = page.getByTestId('region-overlay').element().getBoundingClientRect()
    // Half a region's width to the right, as a share of the dialog's image.
    await pointerDrag(inDialog, from, { x: from.x + overlay.width * 0.1, y: from.y })
    await vi.waitFor(() => expect(patches).toHaveLength(1), { timeout: 3000 })
    expect(Math.abs((patches[0]?.body['x'] ?? 0) - 200)).toBeLessThanOrEqual(3)
    expect(patches[0]?.body['width']).toBe(200)
  })

  it('gives members the regions with no handles and no move cursor', async () => {
    await show(false)
    await expect.element(page.getByRole('img', { name: `${NAME} in build #148` })).toBeVisible()
    expect(boxes()).toHaveLength(0)
    expect(document.querySelectorAll('[data-corner]')).toHaveLength(0)
  })
})
