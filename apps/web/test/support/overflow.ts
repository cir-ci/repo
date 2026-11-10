import { expect } from 'vitest'

/** Elements that reach past the right edge of the window, described for a failure message. */
function overflowers(): string[] {
  return [...document.body.querySelectorAll('*')]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
    .slice(0, 8)
    .map((el) => `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').slice(0, 40)}`)
}

/** The page does not scroll sideways: nothing is wider than the window. */
export function expectNoSidewaysScroll() {
  const wide = document.documentElement.scrollWidth - window.innerWidth
  expect(
    wide,
    `scrolls ${wide}px sideways; reaching past the edge: ${overflowers().join(', ')}`,
  ).toBeLessThanOrEqual(0)
}
