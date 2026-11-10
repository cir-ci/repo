import { expect } from 'vitest'
import { type Locator } from 'vitest/browser'

import { type PaneId, PANES } from '#lib/panes.ts'
import { usePaneStore } from '#lib/stores/pane-store.ts'

import { centerOf, pointerDrag } from './pointer.ts'

/**
 * Drags a pane's separator by `dx` pixels (negative: left) and checks what a page owes: the
 * separator announces the new width, the pane store keeps it, and the pane's box really changed.
 * `measure` returns the pane's current width; `grows` is +1 for a pane to the left of the line
 * (dragging right grows it) and -1 for one to its right.
 */
export async function expectResize(
  handle: Locator,
  pane: PaneId,
  measure: () => number,
  { dx, grows }: { dx: number; grows: 1 | -1 },
) {
  const spec = PANES[pane]
  await expect.element(handle).toBeVisible()
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(spec.default))
  await expect.element(handle).toHaveAttribute('aria-valuemin', String(spec.min))
  await expect.element(handle).toHaveAttribute('aria-valuemax', String(spec.max))
  expect(Math.round(measure())).toBe(spec.default)
  const el = handle.element()
  const at = centerOf(el)
  await pointerDrag(el, at, { x: at.x + dx, y: at.y })
  const next = spec.default + grows * dx
  await expect.element(handle).toHaveAttribute('aria-valuenow', String(next))
  expect(usePaneStore.getState().widths[pane]).toBe(next)
  expect(Math.round(measure())).toBe(next)
}
