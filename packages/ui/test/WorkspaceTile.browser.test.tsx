import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'

import { WorkspaceTile } from '#src/index.ts'

const drawing = (svg: Element) => svg.outerHTML.replaceAll(/id="[^"]*"|url\(#[^)]*\)/g, '')

describe('WorkspaceTile', () => {
  it('draws a bauhaus pattern, decorative', async () => {
    const { container } = await render(<WorkspaceTile seed="acme" />)
    const tile = container.querySelector('span')
    expect(tile?.getAttribute('aria-hidden')).toBe('true')
    expect(tile?.querySelector('svg')?.getAttribute('data-avatar')).toBe('bauhaus')
    expect(tile?.textContent).toBe('')
  })

  it('draws the same pattern for the same seed, a different one for another', async () => {
    const { container } = await render(
      <>
        <WorkspaceTile seed="acme" />
        <WorkspaceTile seed="acme" />
        <WorkspaceTile seed="northwind" />
      </>,
    )
    const [a, b, c] = [...container.querySelectorAll('svg')].map(drawing)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('shows an uploaded picture instead of the pattern', async () => {
    const { container } = await render(<WorkspaceTile seed="acme" picture="/picture.png" />)
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/picture.png')
    expect(container.querySelector('svg')).toBeNull()
  })

  it.each([
    [16, '4px'],
    [20, '6px'],
    [24, '6px'],
  ] as const)('size %i has radius %s', async (size, radius) => {
    const { container } = await render(<WorkspaceTile seed="acme" size={size} />)
    const tile = container.querySelector('span')
    if (!tile) throw new Error('the tile should render')
    const style = getComputedStyle(tile)
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderTopLeftRadius).toBe(radius)
  })
})
