import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'

import { FLASH_MS, hashId, useScrollToHash } from '#lib/scroll-to-hash.ts'
import { renderPage } from '#test/support/render.tsx'

/** A tall page: the target sits far below the first screen, and appears after `delay` (a load). */
function Settings({ delay = 0 }: { delay?: number }) {
  useScrollToHash()
  const [loaded, setLoaded] = useState(delay === 0)
  useEffect(() => {
    if (delay === 0) return undefined
    const timer = window.setTimeout(() => setLoaded(true), delay)
    return () => window.clearTimeout(timer)
  }, [delay])
  return (
    <div>
      <div style={{ height: 2000 }}>Top of the page</div>
      {loaded ? (
        <div id="late-setting">
          <label>
            Late setting <input name="late" />
          </label>
        </div>
      ) : null}
      <div style={{ height: 2000 }}>Bottom of the page</div>
    </div>
  )
}

const show = async (hash: string | undefined, delay = 0) => {
  await page.viewport(800, 500)
  return renderPage(<Settings delay={delay} />, {
    route: '/settings',
    url: hash ? `/settings#${hash}` : '/settings',
  })
}
const target = () => document.getElementById('late-setting')
const inView = () => {
  const rect = target()?.getBoundingClientRect()
  return rect !== undefined && rect.top >= 0 && rect.bottom <= window.innerHeight
}

describe('hashId', () => {
  it('takes the ID from a hash with or without the #, decoded', () => {
    expect(hashId('#merge-gate')).toBe('merge-gate')
    expect(hashId('assign-on-call')).toBe('assign-on-call')
    expect(hashId('#a%20b')).toBe('a b')
    expect(hashId('')).toBe('')
    expect(hashId('#%E0%A4%A')).toBe('%E0%A4%A')
  })
})

describe('useScrollToHash', () => {
  it('scrolls the element into view, tints it and focuses its control', async () => {
    await show('late-setting')
    await expect.poll(inView).toBe(true)
    expect(target()?.className).not.toBe('')
    await expect.element(page.getByRole('textbox', { name: 'Late setting' })).toHaveFocus()
  })

  it('waits for an element that a page renders once its data has loaded', async () => {
    await show('late-setting', 300)
    expect(target()).toBeNull()
    await expect.poll(inView, { timeout: 5000 }).toBe(true)
    expect(target()?.className).not.toBe('')
  })

  it('takes the tint off again after a moment', async () => {
    await show('late-setting')
    await expect.poll(() => target()?.className, { timeout: 2000 }).not.toBe('')
    await expect.poll(() => target()?.className, { timeout: FLASH_MS + 2000 }).toBe('')
  })

  it('jumps instead of scrolling smoothly when the person prefers reduced motion', async () => {
    // The helper reads only `matches`.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
    }))
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    await show('late-setting')
    await expect.poll(() => scroll.mock.calls.length).toBeGreaterThan(0)
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'instant' })
    await expect.poll(inView).toBe(true)
    scroll.mockRestore()
  })

  it.each([undefined, 'nothing-here'])('does nothing for the hash %s', async (hash) => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView')
    await show(hash)
    await expect.element(page.getByText('Top of the page')).toBeVisible()
    expect(scroll).not.toHaveBeenCalled()
    expect(window.scrollY).toBe(0)
    scroll.mockRestore()
  })
})
