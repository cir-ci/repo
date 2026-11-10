import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Avatar, COLOR_SCHEME_ATTRIBUTE, peoplePalette } from '#src/index.ts'

/** The drawing without the per-instance ids (`useId` names each mask). */
const drawing = (svg: Element) => svg.outerHTML.replaceAll(/id="[^"]*"|url\(#[^)]*\)/g, '')

const fills = (svg: Element) =>
  [...svg.querySelectorAll('[fill]')].map((n) => n.getAttribute('fill')?.toLowerCase() ?? '')

describe('Avatar', () => {
  it('is an image named by the name, round, 24px by default, drawing a beam face', async () => {
    await render(<Avatar name="Ada Lovelace" seed="user-1" />)
    const el = page.getByRole('img', { name: 'Ada Lovelace' }).element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual(['24px', '24px'])
    expect(style.borderRadius).toBe('50%')
    const svg = el.querySelector('svg')
    expect(svg?.getAttribute('data-avatar')).toBe('beam')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    // Only the wrapper is an image for assistive technology.
    expect(page.getByRole('img').elements()).toHaveLength(1)
    // Beam draws a face: a mask, and paths for the eyes and mouth.
    expect(svg?.querySelector('mask')).not.toBeNull()
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0)
  })

  it('draws the same face for the same seed, whatever the name', async () => {
    const { container } = await render(
      <>
        <Avatar name="Ada Lovelace" seed="user-1" />
        <Avatar name="Ada King" seed="user-1" />
        <Avatar name="Ada Lovelace" seed="user-2" />
      </>,
    )
    const [a, b, c] = [...container.querySelectorAll('svg')].map(drawing)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('seeds from the name when there is no seed', async () => {
    const { container } = await render(
      <>
        <Avatar name="Ada Lovelace" />
        <Avatar name="Ada Lovelace" seed="Ada Lovelace" />
      </>,
    )
    const [a, b] = [...container.querySelectorAll('svg')].map(drawing)
    expect(a).toBe(b)
  })

  it.each([16, 20, 24, 28, 32, 56])('takes a size of %ipx', async (size) => {
    await render(<Avatar name="Ada" size={size} />)
    const el = page.getByRole('img', { name: 'Ada' }).element()
    const style = getComputedStyle(el)
    expect([style.width, style.height]).toEqual([`${size}px`, `${size}px`])
    expect(style.borderRadius).toBe('50%')
    expect(el.querySelector('svg')?.getBoundingClientRect().width).toBe(size)
  })

  it('shows the image, not the generated face, when it loads', async () => {
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
    await render(<Avatar name="Ada Lovelace" src={pixel} />)
    const avatar = page.getByRole('img', { name: 'Ada Lovelace' })
    await expect.poll(() => avatar.element().querySelector('img')).not.toBeNull()
    expect(avatar.element().querySelector('svg')).toBeNull()
  })

  it('falls back to the generated face when the image fails to load', async () => {
    await render(<Avatar name="Ada Lovelace" src="/does-not-exist.png" />)
    const avatar = page.getByRole('img', { name: 'Ada Lovelace' })
    await expect.poll(() => avatar.element().querySelector('svg')).not.toBeNull()
    expect(avatar.element().querySelector('img')).toBeNull()
  })

  it('draws from the palette of the scheme pinned around it', async () => {
    const seeds = Array.from({ length: 12 }, (_, n) => `user-${n}`)
    const { container } = await render(
      <>
        {(['light', 'dark'] as const).map((scheme) => (
          <div key={scheme} data-scheme={scheme} {...{ [COLOR_SCHEME_ATTRIBUTE]: scheme }}>
            {seeds.map((seed) => (
              <Avatar key={seed} name="Ada" seed={seed} />
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
    // The scheme-specific hues differ, so at least one of the twelve faces is drawn differently.
    expect(svgs('light').map(drawing)).not.toEqual(svgs('dark').map(drawing))
  })
})
