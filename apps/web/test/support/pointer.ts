import { vi } from 'vitest'

export interface Point {
  x: number
  y: number
}

/** The next animation frame: the page has rendered what the events before it caused. */
export const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** The middle of an element, in client pixels. */
export function centerOf(element: Element): Point {
  const { left, top, width, height } = element.getBoundingClientRect()
  return { x: left + width / 2, y: top + height / 2 }
}

/** A point of an element, in client pixels (`x`, `y` from its top-left corner; they may lie outside it). */
export function pointIn(element: Element, x: number, y: number): Point {
  const { left, top } = element.getBoundingClientRect()
  return { x: left + x, y: top + y }
}

/**
 * Chromium refuses pointer capture for synthetic pointers. The element that took the press gets
 * every event of the drag below, which is what capture does for a real one. Call in `beforeEach`
 * and restore in `afterEach`.
 */
export const stubPointerCapture = () =>
  vi.spyOn(Element.prototype, 'setPointerCapture').mockImplementation(() => undefined)

/**
 * A mouse drag on `element`: the press at `from`, a move on the way and one to `to`, and the
 * release there (left out with `release: false`, to hold the button down). A frame passes between
 * the steps, so the page renders each as a real pointer would let it.
 */
export async function pointerDrag(
  element: Element,
  from: Point,
  to: Point,
  { release = true }: { release?: boolean } = {},
) {
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
  await frame()
  fire('pointermove', { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })
  await frame()
  fire('pointermove', to)
  await frame()
  if (release) {
    fire('pointerup', to)
    await frame()
  }
}
