import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { clampSize, ResizeHandle } from '#src/index.ts'

beforeEach(async () => {
  await page.viewport(1200, 800)
})

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

/** A pane beside its handle, the way the app lays them out: the width is a custom property on the container. */
function Split(props: {
  edge?: 'start' | 'end'
  onCollapse?: () => void
  spy?: (value: number) => void
  start?: number
}) {
  const [width, setWidth] = useState(props.start ?? 300)
  const edge = props.edge ?? 'end'
  return (
    <div
      data-testid="split"
      style={{
        position: 'relative',
        width: 900,
        height: 200,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a custom property
        ...({ '--w': `${width}px` } as object),
      }}
    >
      <div style={{ width: 'var(--w)', height: 200 }} data-testid="pane" />
      <ResizeHandle
        label="Resize the pane"
        edge={edge}
        value={width}
        min={200}
        max={500}
        defaultValue={300}
        cssVar="--w"
        style={{ left: edge === 'end' ? 'var(--w)' : 'calc(100% - var(--w))' }}
        onValueChange={(next) => {
          props.spy?.(next)
          setWidth(next)
        }}
        {...(props.onCollapse ? { onCollapse: props.onCollapse } : {})}
      />
    </div>
  )
}

const separator = () => page.getByRole('separator', { name: 'Resize the pane' })

/** A mouse drag by `dx` pixels on the handle: press, two moves, and the release (left out with `release: false`). */
async function drag(dx: number, release = true) {
  const el = separator().element()
  const { left, top, height } = el.getBoundingClientRect()
  const from = { x: left + 4, y: top + height / 2 }
  const fire = (type: string, x: number) =>
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
        clientX: x,
        clientY: from.y,
      }),
    )
  fire('pointerdown', from.x)
  await frame()
  fire('pointermove', from.x + dx / 2)
  fire('pointermove', from.x + dx)
  await frame()
  if (release) {
    fire('pointerup', from.x + dx)
    await frame()
  }
}

const paneWidth = () => page.getByTestId('pane').element().getBoundingClientRect().width

describe('ResizeHandle semantics', () => {
  it('is a focusable vertical separator that announces its value and range', async () => {
    await render(<Split />)
    const el = separator()
    await expect.element(el).toHaveAttribute('aria-orientation', 'vertical')
    await expect.element(el).toHaveAttribute('aria-valuenow', '300')
    await expect.element(el).toHaveAttribute('aria-valuemin', '200')
    await expect.element(el).toHaveAttribute('aria-valuemax', '500')
    await expect.element(el).toHaveAttribute('aria-valuetext', '300 pixels')
    await expect.element(el).toHaveAttribute('tabindex', '0')
    expect(getComputedStyle(el.element()).cursor).toBe('col-resize')
  })

  it('has a hit area of at least 8px and a 1px line', async () => {
    await render(<Split />)
    const el = separator().element()
    expect(el.getBoundingClientRect().width).toBeGreaterThanOrEqual(8)
    expect(getComputedStyle(el, '::after').width).toBe('1px')
  })

  it('highlights on hover and while dragging', async () => {
    await render(<Split />)
    const el = separator().element()
    const idle = getComputedStyle(el, '::after').backgroundColor
    await drag(20, false)
    expect(getComputedStyle(el, '::after').backgroundColor).not.toBe(idle)
    expect(el.hasAttribute('data-active')).toBe(true)
  })
})

describe('ResizeHandle keyboard', () => {
  it('moves by 16px with the arrows and 64px with Shift', async () => {
    await render(<Split />)
    separator().element().focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '316')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '284')
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '348')
    expect(paneWidth()).toBe(348)
  })

  it('jumps to the minimum and maximum with Home and End', async () => {
    await render(<Split />)
    separator().element().focus()
    await userEvent.keyboard('{Home}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '200')
    await userEvent.keyboard('{End}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '500')
  })

  it('stops at the limits', async () => {
    const spy = vi.fn<(value: number) => void>()
    await render(<Split start={490} spy={spy} />)
    separator().element().focus()
    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '500')
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(() => spy).toHaveBeenCalledTimes(1)
  })

  it('restores the default with Enter and with a double click', async () => {
    await render(<Split start={420} />)
    separator().element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '300')
    await userEvent.keyboard('{End}')
    await userEvent.dblClick(separator())
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '300')
  })

  it('moves the line the other way for a pane on its right (edge start)', async () => {
    await render(<Split edge="start" />)
    separator().element().focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '316')
  })
})

describe('ResizeHandle pointer drag', () => {
  it('follows the pointer through the custom property and commits once on release', async () => {
    const spy = vi.fn<(value: number) => void>()
    await render(<Split spy={spy} />)
    await drag(80, false)
    expect(paneWidth()).toBe(380)
    expect(separator().element().getAttribute('aria-valuenow')).toBe('380')
    // Nothing went through React while the button was down.
    expect(spy).not.toHaveBeenCalled()
    const el = separator().element()
    el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, button: 0 }))
    await frame()
    expect(spy).toHaveBeenCalledExactlyOnceWith(380)
    expect(paneWidth()).toBe(380)
  })

  it('clamps to the minimum and maximum', async () => {
    await render(<Split />)
    await drag(900)
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '500')
    expect(paneWidth()).toBe(500)
    await drag(-60)
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '440')
    await drag(-500)
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '200')
  })

  it('grows a pane on its right when dragged left (edge start)', async () => {
    await render(<Split edge="start" />)
    await drag(-60)
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '360')
  })

  it('collapses when dragged well past the minimum and the pane can collapse', async () => {
    const onCollapse = vi.fn<() => void>()
    await render(<Split start={210} onCollapse={onCollapse} />)
    await drag(-200)
    expect(onCollapse).toHaveBeenCalledOnce()
  })

  it('stays open at the minimum when a drag goes only a little past it', async () => {
    const onCollapse = vi.fn<() => void>()
    await render(<Split start={210} onCollapse={onCollapse} />)
    await drag(-120)
    expect(onCollapse).not.toHaveBeenCalled()
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '200')
  })

  it('does not collapse a pane that only resizes', async () => {
    await render(<Split start={210} />)
    await drag(-300)
    await expect.element(separator()).toHaveAttribute('aria-valuenow', '200')
  })
})

describe('clampSize', () => {
  it('rounds and holds a value to its range', () => {
    expect(clampSize(250.6, 200, 300)).toBe(251)
    expect(clampSize(10, 200, 300)).toBe(200)
    expect(clampSize(1000, 200, 300)).toBe(300)
  })
})
