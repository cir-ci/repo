import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { ScrollArea } from '#src/index.ts'

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

function Harness({ width = 600, height = 1200 }: { width?: number; height?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 200,
        height: 200,
        marginLeft: 400,
        marginTop: 100,
      }}
    >
      <ScrollArea aria-label="Area" data-testid="scroller">
        <div style={{ width, height }} />
      </ScrollArea>
    </div>
  )
}

const html = (el: Element | null | undefined): HTMLElement => {
  if (!(el instanceof HTMLElement)) throw new Error('not an element')
  return el
}
const scroller = () => html(page.getByTestId('scroller').element())
const thumbOf = (bar: Element) => html(bar.firstElementChild)
const barY = () => page.getByTestId('scrollbar-y')

describe('ScrollArea', () => {
  it('hides the native bars so the content runs to the edge', async () => {
    await render(<Harness />)
    await expect.element(barY()).toBeInTheDocument()
    const el = scroller()
    expect(el.offsetWidth - el.clientWidth).toBe(0)
    expect(el.offsetHeight - el.clientHeight).toBe(0)
  })

  it('draws a thumb for each overflowing axis only, aria-hidden', async () => {
    await render(<Harness width={100} />)
    await expect.element(barY()).toBeInTheDocument()
    await expect.element(barY()).toHaveAttribute('aria-hidden', 'true')
    expect(document.querySelector('[data-testid="scrollbar-x"]')).toBeNull()
  })

  it('draws none when nothing overflows', async () => {
    await render(<Harness width={100} height={100} />)
    await frame()
    expect(document.querySelector('[data-testid="scrollbar-y"]')).toBeNull()
    expect(document.querySelector('[data-testid="scrollbar-x"]')).toBeNull()
  })

  it('shows on scroll, moves the thumb with it, and fades out later', async () => {
    await render(<Harness />)
    await expect.element(barY()).toBeInTheDocument()
    // A pointer left over the area by an earlier test keeps the thumbs showing.
    await userEvent.unhover(page.getByTestId('scroller'))
    const bar = barY().element()
    const thumb = thumbOf(bar)
    const before = thumb.style.top
    scroller().scrollTop = 300
    await expect.poll(() => bar.hasAttribute('data-visible')).toBe(true)
    await expect.poll(() => thumb.style.top).not.toBe(before)
    await expect.poll(() => bar.hasAttribute('data-visible'), { timeout: 3000 }).toBe(false)
  })

  it('follows a resize of the content', async () => {
    const { rerender } = await render(<Harness height={400} />)
    await expect.element(barY()).toBeInTheDocument()
    const thumb = thumbOf(barY().element())
    const before = thumb.style.height
    await rerender(<Harness height={2000} />)
    await expect.poll(() => thumb.style.height).not.toBe(before)
  })

  it('scrolls when the thumb is dragged', async () => {
    await render(<Harness />)
    await expect.element(barY()).toBeInTheDocument()
    const thumb = thumbOf(barY().element())
    const box = thumb.getBoundingClientRect()
    const fire = (type: string, y: number) =>
      thumb.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 1,
          clientX: box.left + 2,
          clientY: y,
        }),
      )
    fire('pointerdown', box.top + 4)
    fire('pointermove', box.top + 4 + 20)
    expect(scroller().scrollTop).toBeGreaterThan(0)
    fire('pointerup', box.top + 24)
  })

  it('pages the content when the track beside the thumb is pressed', async () => {
    await render(<Harness />)
    await expect.element(barY()).toBeInTheDocument()
    const bar = barY().element()
    const box = bar.getBoundingClientRect()
    bar.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: box.left + 5,
        clientY: box.bottom - 5,
      }),
    )
    await expect.poll(() => scroller().scrollTop).toBeGreaterThan(100)
  })

  it('keeps scrolling natively', async () => {
    await render(<Harness />)
    const el = scroller()
    expect(getComputedStyle(el).overflowY).toBe('auto')
    expect(el.scrollHeight).toBeGreaterThan(el.clientHeight)
  })
})
