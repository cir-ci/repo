import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { TEAM_ICON_NAMES, TeamTile } from '#src/index.ts'

/** The drawing without the per-instance ids (`useId` names each mask). */
const drawing = (svg: Element) => svg.outerHTML.replaceAll(/id="[^"]*"|url\(#[^)]*\)/g, '')

describe('TeamTile', () => {
  it('draws a marble, decorative by default', async () => {
    const { container } = await render(<TeamTile name="web app" color="slate" />)
    const tile = container.querySelector('span')
    expect(tile?.getAttribute('aria-hidden')).toBe('true')
    expect(tile?.hasAttribute('role')).toBe(false)
    expect(tile?.querySelector('svg')?.getAttribute('data-avatar')).toBe('marble')
    expect(tile?.textContent).toBe('')
  })

  it('is an image named by the team when labelled', async () => {
    await render(<TeamTile name="Storefront" color="plum" labelled />)
    const tile = page.getByRole('img', { name: 'Storefront' })
    await expect.element(tile).toBeVisible()
    expect(page.getByRole('img').elements()).toHaveLength(1)
  })

  it('draws the same marble for the same seed, a different one for another', async () => {
    const { container } = await render(
      <>
        <TeamTile name="Web" seed="web" color="slate" />
        <TeamTile name="Website" seed="web" color="slate" />
        <TeamTile name="Web" seed="mobile" color="slate" />
      </>,
    )
    const [a, b, c] = [...container.querySelectorAll('svg')].map((svg) => drawing(svg))
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('uses shades of the team colour, so another colour looks different', async () => {
    const { container } = await render(
      <>
        <TeamTile name="Web" seed="web" color="slate" />
        <TeamTile name="Web" seed="web" color="plum" />
      </>,
    )
    const [a, b] = [...container.querySelectorAll('svg')].map((svg) => drawing(svg))
    expect(a).not.toBe(b)
  })

  it.each([
    [16, '4px'],
    [20, '6px'],
    [24, '6px'],
    [40, '10px'],
  ] as const)('size %i has radius %s', async (size, radius) => {
    await render(<TeamTile name="Mobile" color="olive" size={size} labelled />)
    const el = page.getByRole('img').element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderTopLeftRadius).toBe(radius)
    expect(el.querySelector('svg')?.getBoundingClientRect().width).toBe(size)
  })

  it.each([
    [16, '12px'],
    [20, '14px'],
    [24, '16px'],
    [40, '24px'],
  ] as const)('shows a %i tile icon at %s on the marble', async (size, iconSize) => {
    const { container } = await render(
      <TeamTile name="Mobile" color="mauve" icon="rocket" size={size} labelled />,
    )
    const icon = container.querySelector('svg.lucide, svg:not([data-avatar])')
    expect(icon?.getAttribute('width')).toBe(iconSize.replace('px', ''))
    expect(container.querySelector('svg[data-avatar="marble"]')).not.toBeNull()
    expect(container.textContent).toBe('')
  })

  it.each(TEAM_ICON_NAMES)('renders the %s icon on the marble', async (icon) => {
    const { container } = await render(<TeamTile name="X" color="graphite" icon={icon} />)
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it('allows 31 icons', () => {
    expect(TEAM_ICON_NAMES).toHaveLength(31)
  })
})
