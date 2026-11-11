import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import {
  CirciTheme,
  COLOR_SCHEME_ATTRIBUTE,
  ColorSchemeControl,
  MODE_STORAGE_KEY,
} from '#src/index.ts'

/** A `matchMedia` whose `(prefers-color-scheme: light)` answer the test controls. */
function fakeSystem(initial: 'light' | 'dark') {
  let light = initial === 'light'
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query.includes('light') ? light : !light
    },
    media: query,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }))
  return {
    set(next: 'light' | 'dark') {
      light = next === 'light'
      for (const fn of listeners) fn()
    },
  }
}

const scheme = () => document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.documentElement.removeAttribute(COLOR_SCHEME_ATTRIBUTE)
  localStorage.clear()
})

const withControl = (mode?: 'light' | 'dark') => (
  <CirciTheme {...(mode ? { mode } : {})}>
    <ColorSchemeControl />
  </CirciTheme>
)

describe('CirciTheme', () => {
  it('marks the document with a pinned scheme', async () => {
    await render(<CirciTheme mode="light">x</CirciTheme>)
    await expect.poll(() => scheme()).toBe('light')
  })

  it('does not store a pinned scheme, and ignores the stored choice', async () => {
    localStorage.setItem(MODE_STORAGE_KEY, 'light')
    await render(withControl('dark'))
    await expect.poll(() => scheme()).toBe('dark')
    await page.getByRole('button', { name: 'Light' }).click()
    await expect.poll(() => scheme()).toBe('dark')
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('light')
  })

  it('follows the system, live', async () => {
    const system = fakeSystem('light')
    await render(<CirciTheme>x</CirciTheme>)
    await expect.poll(() => scheme()).toBe('light')
    system.set('dark')
    await vi.waitFor(() => expect(scheme()).toBe('dark'))
    expect(localStorage.length).toBe(0)
  })

  it('applies the stored choice on mount, over the system', async () => {
    fakeSystem('dark')
    localStorage.setItem(MODE_STORAGE_KEY, 'light')
    await render(withControl())
    await expect.poll(() => scheme()).toBe('light')
    await expect
      .element(page.getByRole('button', { name: 'Light' }))
      .toHaveAttribute('aria-pressed', 'true')
  })

  it('stores a choice made with setMode and sets the attribute', async () => {
    fakeSystem('light')
    await render(withControl())
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect.poll(() => scheme()).toBe('dark')
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('dark')
  })

  it('goes back to following the system when System is chosen', async () => {
    const system = fakeSystem('light')
    localStorage.setItem(MODE_STORAGE_KEY, 'dark')
    await render(withControl())
    await expect.poll(() => scheme()).toBe('dark')
    await page.getByRole('button', { name: 'System' }).click()
    await expect.poll(() => localStorage.getItem(MODE_STORAGE_KEY)).toBe('system')
    expect(scheme()).toBe('light')
    system.set('dark')
    await vi.waitFor(() => expect(scheme()).toBe('dark'))
  })

  it('works when localStorage throws', async () => {
    fakeSystem('light')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    await render(withControl())
    await expect.poll(() => scheme()).toBe('light')
    await page.getByRole('button', { name: 'Dark' }).click()
    await expect.poll(() => scheme()).toBe('dark')
  })

  it('ignores a stored value that is not a mode', async () => {
    fakeSystem('light')
    localStorage.setItem(MODE_STORAGE_KEY, 'purple')
    await render(<CirciTheme>x</CirciTheme>)
    await expect.poll(() => scheme()).toBe('light')
  })
})
