import { expect } from 'vitest'
import { page as browserPage, type Locator } from 'vitest/browser'

import { type PaneId, paneLimits, PANES } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'

import { expectNoSidewaysScroll } from './overflow.ts'
import { centerOf, pointerDrag } from './pointer.ts'

/** The width of an element, 0 for none. */
export const widthOf = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0

/** The element's parent (the container a separator sits in). */
export function parentOf(el: Element): HTMLElement {
  const parent = el.parentElement
  if (!parent) throw new Error('The element has no parent')
  return parent
}

/**
 * Drags a pane's separator by `dx` pixels (negative: left) and checks what a page owes: the
 * separator announces the new width, the pane store keeps it, and the pane's box really changed.
 * `measure` returns the pane's current width; `grows` is +1 for a pane to the left of the line
 * (dragging right grows it) and -1 for one to its right. The range it expects is `paneLimits` for
 * the handle's container (the viewport is wide enough in these tests for the default to fit).
 */
export async function expectResize(
  handle: Locator,
  pane: PaneId,
  measure: () => number,
  { dx, grows }: { dx: number; grows: 1 | -1 },
) {
  const spec = PANES[pane]
  await expect.element(handle).toBeVisible()
  // The range is the pane's, held to the space its container has (what the handle sits in).
  const container = Math.floor(handle.element().parentElement?.getBoundingClientRect().width ?? 0)
  const limits = paneLimits(pane, container)
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(spec.default))
  await expect.element(handle).toHaveAttribute('aria-valuemin', String(limits.min))
  await expect.element(handle).toHaveAttribute('aria-valuemax', String(limits.max))
  expect(Math.round(measure())).toBe(spec.default)
  const el = handle.element()
  const at = centerOf(el)
  await pointerDrag(el, at, { x: at.x + dx, y: at.y })
  const next = spec.default + grows * dx
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(next))
  expect(usePaneStore.getState().widths[pane]).toBe(next)
  expect(Math.round(measure())).toBe(next)
}

/**
 * What a pane owes a narrow window while a wide one's width is stored (the caller seeds the store
 * with the pane's absolute maximum and renders at a viewport that is still wide enough to show the
 * handle but too narrow for that width):
 * - the pane is no wider than its share of its container, and the content beside it keeps
 *   `minMain` less the gap;
 * - the handle's range is the pane's range in that container, its value is the rendered width and
 *   its line sits on the pane's edge;
 * - a drag far past the largest width stops at it, and one past the smallest stops there;
 * - narrowing the window to `to` shrinks the rendered pane, live, and the range with it, while the
 *   stored width is left alone.
 * `pane` finds the pane's box, `main` is the width of the content beside it, `container` what both sit in;
 * `grows` is as for `expectResize`.
 */
export async function expectLimitedToSpace(
  handle: Locator,
  id: PaneId,
  {
    pane,
    main,
    container,
    grows,
    to,
    height = 800,
    gap = 12,
    collapsible = false,
  }: {
    pane: () => Element
    main: () => number
    container: () => Element
    grows: 1 | -1
    to: number
    height?: number
    gap?: number
    /** A drag past the smallest width collapses the pane (the navigation panes), so that drag is left out. */
    collapsible?: boolean
  },
) {
  const spec = PANES[id]
  const paneWidth = () => Math.round(widthOf(pane()))
  const limitsNow = () => paneLimits(id, Math.floor(widthOf(container())))
  const checkSpace = () => {
    expect(paneWidth()).toBeLessThanOrEqual(Math.floor(widthOf(container()) * spec.maxShare) + 1)
    expect(main()).toBeGreaterThanOrEqual(spec.minMain - gap - 1)
    expectNoSidewaysScroll()
  }

  expect(usePaneStore.getState().widths[id]).toBe(spec.max)
  await expect.element(handle).toBeVisible()
  expect(limitsNow().max).toBeLessThan(spec.max)
  await expect.element(handle).toHaveAttribute('aria-valuemax', String(limitsNow().max))
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(paneWidth()))
  checkSpace()

  // The line sits on the pane's real edge (the pane's own edge, or half a gap from it).
  const line = centerOf(handle.element())
  const box = pane().getBoundingClientRect()
  expect(Math.abs(line.x - (grows === 1 ? box.right : box.left))).toBeLessThanOrEqual(gap / 2 + 1)

  // A drag well past the largest width stops at it; one past the smallest stops there.
  await pointerDrag(handle.element(), line, { x: line.x + grows * 600, y: line.y })
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(limitsNow().max))
  expect(paneWidth()).toBe(limitsNow().max)
  if (!collapsible) {
    const again = centerOf(handle.element())
    await pointerDrag(handle.element(), again, { x: again.x - grows * 1200, y: again.y })
    await expect.element(handle).toHaveAttribute('aria-valuenow', String(limitsNow().min))
    expect(paneWidth()).toBe(limitsNow().min)
    usePaneStore.getState().setWidth(id, spec.max)
    await expect.element(handle).toHaveAttribute('aria-valuenow', String(limitsNow().max))
  }

  // The window narrows: the pane follows with no event of its own, and the stored width stays.
  const before = paneWidth()
  await browserPage.viewport(to, height)
  await expect.poll(paneWidth).toBeLessThan(before)
  checkSpace()
  await expect.element(handle).toHaveAttribute('aria-valuemax', String(limitsNow().max))
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(paneWidth()))
  expect(usePaneStore.getState().widths[id]).toBe(spec.max)
}
