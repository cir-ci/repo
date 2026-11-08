import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { TEAM_ICON_NAMES, TeamTile } from '#src/index.ts'

describe('TeamTile', () => {
  it('shows the first letter, decorative by default', async () => {
    const { container } = await render(<TeamTile name="web app" color="slate" />)
    const tile = container.querySelector('span')
    expect(tile?.textContent).toBe('W')
    expect(tile?.getAttribute('aria-hidden')).toBe('true')
    expect(tile?.hasAttribute('role')).toBe(false)
  })

  it('is an image named by the team when labelled', async () => {
    await render(<TeamTile name="Storefront" color="plum" labelled />)
    await expect.element(page.getByRole('img', { name: 'Storefront' })).toHaveTextContent('S')
  })

  it.each([
    [16, '4px', '11px'],
    [20, '6px', '11px'],
    [24, '6px', '13px'],
    [40, '10px', '18px'],
  ] as const)('size %i has radius %s and %s letters', async (size, radius, fontSize) => {
    await render(<TeamTile name="Mobile" color="olive" size={size} labelled />)
    const style = getComputedStyle(page.getByRole('img').element())
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderTopLeftRadius).toBe(radius)
    expect(style.fontSize).toBe(fontSize)
  })

  it('draws the team colour behind tile-text', async () => {
    await render(<TeamTile name="Mobile" color="moss" labelled />)
    const el = page.getByRole('img').element()
    const root = getComputedStyle(document.documentElement)
    const style = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.color = root.getPropertyValue('--circi-team-moss')
    document.body.append(probe)
    expect(style.backgroundColor).toBe(getComputedStyle(probe).color)
    probe.remove()
  })

  it.each([
    [16, '12px'],
    [20, '14px'],
    [24, '16px'],
    [40, '24px'],
  ] as const)('shows a %i tile icon at %s instead of the letter', async (size, iconSize) => {
    const { container } = await render(
      <TeamTile name="Mobile" color="mauve" icon="rocket" size={size} labelled />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe(iconSize.replace('px', ''))
    expect(container.textContent).toBe('')
  })

  it.each(TEAM_ICON_NAMES)('renders the %s icon', async (icon) => {
    const { container } = await render(<TeamTile name="X" color="graphite" icon={icon} />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('allows 31 icons', () => {
    expect(TEAM_ICON_NAMES).toHaveLength(31)
  })
})
