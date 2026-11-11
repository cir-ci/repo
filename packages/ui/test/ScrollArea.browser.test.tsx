import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { ScrollArea } from '#src/index.ts'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function Harness({ width = 600, height = 1200 }: { width?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: 200, height: 200 }}>
      <ScrollArea aria-label="Area" data-testid="viewport">
        <div style={{ width, height }} />
      </ScrollArea>
    </div>
  )
}

const viewport = () => {
  const el = page.getByTestId('viewport').element()
  if (!(el instanceof HTMLElement)) throw new Error('not an element')
  return el
}
const root = () => viewport().parentElement!
const bars = (orientation: 'vertical' | 'horizontal') =>
  [...root().querySelectorAll(`[data-orientation='${orientation}']`)].filter(
    (el) => el.parentElement === root(),
  )

describe('ScrollArea', () => {
  it('scrolls natively with its own bars hidden, marked for the region drag', async () => {
    await render(<Harness />)
    const el = viewport()
    expect(el.hasAttribute('data-scroll-area')).toBe(true)
    // No native bar takes room: the content runs to the edge.
    expect(el.offsetWidth - el.clientWidth).toBe(0)
    expect(el.offsetHeight - el.clientHeight).toBe(0)
    el.scrollTop = 300
    el.scrollLeft = 100
    expect(el.scrollTop).toBe(300)
    expect(el.scrollLeft).toBe(100)
  })

  it('lays a slim thumb over each overflowing axis, and none when nothing overflows', async () => {
    const view = await render(<Harness />)
    await frame()
    await expect.poll(() => bars('vertical').length, { timeout: 15_000 }).toBe(1)
    await expect.poll(() => bars('horizontal').length, { timeout: 15_000 }).toBe(1)
    const thumb = bars('vertical')[0]!.firstElementChild!
    await expect.poll(() => Math.round(thumb.getBoundingClientRect().width)).toBe(6)

    // A fresh mount with content that fits. Base UI only observes the viewport's own size, which
    // stays 200 x 200 when the content inside shrinks, so a rerender is measured only if it lands
    // before the observer's first delivery: not a thing to rely on under load.
    await view.unmount()
    await render(<Harness width={100} height={100} />)
    // oxlint-disable-next-line eslint/no-await-in-loop -- one frame after another
    for (let i = 0; i < 5; i++) await frame() // long enough for a wrongly shown bar to appear
    await expect.poll(() => bars('vertical').length).toBe(0)
    await expect.poll(() => bars('horizontal').length).toBe(0)
  })

  it('shows the bars while the area is hovered, and keeps them hidden otherwise', async () => {
    await render(<Harness />)
    await expect.poll(() => bars('vertical').length).toBe(1)
    const bar = bars('vertical')[0]!
    expect(getComputedStyle(bar).pointerEvents).toBe('none')
    await userEvent.hover(viewport())
    await expect.poll(() => bar.hasAttribute('data-hovering')).toBe(true)
    await expect.poll(() => getComputedStyle(bar).opacity).toBe('1')
  })
})
