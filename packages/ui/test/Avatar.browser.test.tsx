import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import {
  Avatar,
  COLOR_SCHEME_ATTRIBUTE,
  peoplePalette,
  projectPalette,
  workspacePalette,
} from '#src/index.ts'

/** The drawing without the per-instance ids (`useId` names each mask). */
const drawing = (svg: Element) => svg.outerHTML.replaceAll(/id="[^"]*"|url\(#[^)]*\)/g, '')
const drawings = (container: Element) => [...container.querySelectorAll('svg')].map(drawing)

const fills = (svg: Element) =>
  [...svg.querySelectorAll('[fill]')].map((n) => n.getAttribute('fill')?.toLowerCase() ?? '')

const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

describe('Avatar, type user', () => {
  it('is an image named by the name, round, 24px by default, drawing a beam face', async () => {
    await render(<Avatar type="user" id="user-1" name="Ada Lovelace" image={null} />)
    const el = page.getByRole('img', { name: 'Ada Lovelace' }).element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual(['24px', '24px'])
    expect(style.borderRadius).toBe('50%')
    const svg = el.querySelector('svg')
    expect(svg?.getAttribute('data-avatar')).toBe('beam')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    // Only the wrapper is an image for assistive technology.
    expect(page.getByRole('img').elements()).toHaveLength(1)
    expect(svg?.querySelector('mask')).not.toBeNull()
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('draws the same face for the same ID, whatever the name, and another for another ID', async () => {
    const { container } = await render(
      <>
        <Avatar type="user" id="user-1" name="Ada Lovelace" image={null} />
        <Avatar type="user" id="user-1" name="Ada King" image={null} />
        <Avatar type="user" id="user-2" name="Ada Lovelace" image={null} />
      </>,
    )
    const [a, b, c] = drawings(container)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it.each([16, 20, 24, 28, 32, 56])('takes a size of %ipx', async (size) => {
    await render(<Avatar type="user" id="u" name="Ada" image={null} size={size} />)
    const el = page.getByRole('img', { name: 'Ada' }).element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderRadius).toBe('50%')
    expect(el.querySelector('svg')?.getBoundingClientRect().width).toBe(size)
  })

  it('shows the picture, not the generated face, when it loads', async () => {
    await render(<Avatar type="user" id="u" name="Ada Lovelace" image={PIXEL} />)
    const avatar = page.getByRole('img', { name: 'Ada Lovelace' })
    await expect.poll(() => avatar.element().querySelector('img')).not.toBeNull()
    expect(avatar.element().querySelector('svg')).toBeNull()
  })

  it('falls back to the generated face when the picture fails to load', async () => {
    await render(<Avatar type="user" id="u" name="Ada Lovelace" image="/does-not-exist.png" />)
    const avatar = page.getByRole('img', { name: 'Ada Lovelace' })
    await expect.poll(() => avatar.element().querySelector('svg')).not.toBeNull()
    expect(avatar.element().querySelector('img')).toBeNull()
  })

  it('draws from the palette of the scheme pinned around it', async () => {
    const ids = Array.from({ length: 12 }, (_, n) => `user-${n}`)
    const { container } = await render(
      <>
        {(['light', 'dark'] as const).map((scheme) => (
          <div key={scheme} data-scheme={scheme} {...{ [COLOR_SCHEME_ATTRIBUTE]: scheme }}>
            {ids.map((id) => (
              <Avatar key={id} type="user" id={id} name="Ada" image={null} />
            ))}
          </div>
        ))}
      </>,
    )
    const svgs = (scheme: string) => [
      ...container.querySelectorAll(`[data-scheme="${scheme}"] svg`),
    ]
    const colours = (scheme: 'light' | 'dark') =>
      svgs(scheme).flatMap((svg) =>
        fills(svg).filter((f) => !['none', '#ffffff', '#000000'].includes(f)),
      )
    await expect
      .poll(() => colours('dark').every((f) => peoplePalette('dark').includes(f)))
      .toBe(true)
    expect(colours('light').every((f) => peoplePalette('light').includes(f))).toBe(true)
    expect(svgs('light').map(drawing)).not.toEqual(svgs('dark').map(drawing))
  })
})

describe('Avatar, type project', () => {
  it('is an image named by the project, drawing a marble', async () => {
    await render(<Avatar type="project" slug="web" name="Storefront" color="plum" icon={null} />)
    const el = page.getByRole('img', { name: 'Storefront' }).element()
    expect(el.querySelector('svg')?.getAttribute('data-avatar')).toBe('marble')
    expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(page.getByRole('img').elements()).toHaveLength(1)
    expect(el.textContent).toBe('')
  })

  it('draws the same marble for the same slug, whatever the name, and another for another slug', async () => {
    const { container } = await render(
      <>
        <Avatar type="project" slug="web" name="Web" color="slate" icon={null} />
        <Avatar type="project" slug="web" name="Website" color="slate" icon={null} />
        <Avatar type="project" slug="mobile" name="Web" color="slate" icon={null} />
      </>,
    )
    const [a, b, c] = drawings(container)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('uses shades of the project colour, so another colour looks different', async () => {
    const { container } = await render(
      <>
        <Avatar type="project" slug="web" name="Web" color="slate" icon={null} />
        <Avatar type="project" slug="web" name="Web" color="plum" icon={null} />
      </>,
    )
    const [a, b] = drawings(container)
    expect(a).not.toBe(b)
  })

  it('draws from the shades of its colour in the scheme pinned around it', async () => {
    const { container } = await render(
      <div {...{ [COLOR_SCHEME_ATTRIBUTE]: 'light' }}>
        <Avatar type="project" slug="web" name="Web" color="moss" icon={null} />
      </div>,
    )
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('the marble should render')
    const shades = projectPalette('moss', 'light')
    await expect.poll(() => fills(svg).some((f) => shades.includes(f))).toBe(true)
  })

  it.each([
    [16, '4px'],
    [18, '6px'],
    [20, '6px'],
    [24, '6px'],
    [40, '10px'],
  ] as const)('size %i has radius %s', async (size, radius) => {
    await render(
      <Avatar type="project" slug="mobile" name="Mobile" color="olive" icon={null} size={size} />,
    )
    const el = page.getByRole('img').element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderTopLeftRadius).toBe(radius)
    expect(el.querySelector('svg')?.getBoundingClientRect().width).toBe(size)
  })

  it('has no icon when it has none, and an unknown name draws none', async () => {
    const { container } = await render(
      <>
        <Avatar type="project" slug="a" name="A" color="slate" icon={null} />
        <Avatar type="project" slug="b" name="B" color="slate" icon="not-an-icon" />
      </>,
    )
    expect(container.querySelectorAll('svg')).toHaveLength(2)
  })

  it.each([
    [16, '12'],
    [18, '13'],
    [20, '14'],
    [24, '16'],
    [40, '24'],
  ] as const)('shows a %i avatar icon at %s on the marble', async (size, iconSize) => {
    const { container } = await render(
      <Avatar type="project" slug="mobile" name="Mobile" color="mauve" icon="rocket" size={size} />,
    )
    // The box is there before the icon has loaded, so nothing shifts when it arrives.
    const box = container.querySelector('svg[data-avatar="marble"] ~ span')
    expect(box?.getBoundingClientRect().width).toBe(Number(iconSize))
    await expect.poll(() => container.querySelector('svg:not([data-avatar])')).not.toBeNull()
    const icon = container.querySelector('svg:not([data-avatar])')
    expect(icon?.getAttribute('width')).toBe(iconSize)
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(container.querySelector('svg[data-avatar="marble"]')).not.toBeNull()
    expect(container.textContent).toBe('')
  })

  it.each(['rocket', 'dog', 'chart-bar', 'a-arrow-down'])(
    'loads the %s icon on demand and draws it on the marble',
    async (icon) => {
      const { container } = await render(
        <Avatar type="project" slug="x" name="X" color="graphite" icon={icon} />,
      )
      await expect.poll(() => container.querySelectorAll('svg')).toHaveLength(2)
      expect(container.querySelector('svg:not([data-avatar])')?.getAttribute('class')).toContain(
        `lucide-${icon}`,
      )
    },
  )
})

describe('Avatar, type workspace', () => {
  it('is an image named by the workspace, drawing a bauhaus pattern, 20px by default', async () => {
    await render(<Avatar type="workspace" slug="acme" name="Acme" picture={null} />)
    const el = page.getByRole('img', { name: 'Acme' }).element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual(['20px', '20px'])
    expect(el.querySelector('svg')?.getAttribute('data-avatar')).toBe('bauhaus')
    expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    expect(page.getByRole('img').elements()).toHaveLength(1)
  })

  it('draws the same pattern for the same slug, whatever the name, and another for another slug', async () => {
    const { container } = await render(
      <>
        <Avatar type="workspace" slug="acme" name="Acme" picture={null} />
        <Avatar type="workspace" slug="acme" name="Acme Corp" picture={null} />
        <Avatar type="workspace" slug="northwind" name="Acme" picture={null} />
      </>,
    )
    const [a, b, c] = drawings(container)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('shows the picture instead of the pattern when it loads', async () => {
    await render(<Avatar type="workspace" slug="acme" name="Acme" picture={PIXEL} />)
    const avatar = page.getByRole('img', { name: 'Acme' })
    await expect.poll(() => avatar.element().querySelector('img')).not.toBeNull()
    expect(avatar.element().querySelector('svg')).toBeNull()
  })

  it('falls back to the pattern when the picture fails to load', async () => {
    await render(<Avatar type="workspace" slug="acme" name="Acme" picture="/does-not-exist.png" />)
    const avatar = page.getByRole('img', { name: 'Acme' })
    await expect.poll(() => avatar.element().querySelector('svg')).not.toBeNull()
    expect(avatar.element().querySelector('img')).toBeNull()
  })

  it('draws from the workspace palette of the scheme pinned around it', async () => {
    const { container } = await render(
      <div {...{ [COLOR_SCHEME_ATTRIBUTE]: 'light' }}>
        <Avatar type="workspace" slug="acme" name="Acme" picture={null} />
      </div>,
    )
    const svg = container.querySelector('svg')
    if (!svg) throw new Error('the pattern should render')
    const palette = workspacePalette('light')
    await expect.poll(() => fills(svg).some((f) => palette.includes(f))).toBe(true)
  })

  it.each([
    [16, '4px'],
    [20, '6px'],
    [24, '6px'],
  ] as const)('size %i has radius %s', async (size, radius) => {
    await render(<Avatar type="workspace" slug="acme" name="Acme" picture={null} size={size} />)
    const style = getComputedStyle(page.getByRole('img').element())
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderTopLeftRadius).toBe(radius)
  })
})
