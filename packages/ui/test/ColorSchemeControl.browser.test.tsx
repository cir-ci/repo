import { afterEach, describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import {
  CirciTheme,
  COLOR_SCHEME_ATTRIBUTE,
  ColorSchemeControl,
  MODE_STORAGE_KEY,
} from '../src/index.ts'

afterEach(() => {
  document.documentElement.removeAttribute(COLOR_SCHEME_ATTRIBUTE)
  localStorage.clear()
})

describe('ColorSchemeControl', () => {
  it('offers System, Light and Dark in a group named Theme', async () => {
    await render(
      <CirciTheme>
        <ColorSchemeControl />
      </CirciTheme>,
    )
    await expect.element(page.getByRole('group', { name: 'Theme' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'System' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Light' })).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Dark' })).toBeVisible()
  })

  it('switches the scheme and remembers the choice', async () => {
    await render(
      <CirciTheme>
        <ColorSchemeControl />
      </CirciTheme>,
    )
    const light = page.getByRole('button', { name: 'Light' })
    await light.click()
    await expect.element(light).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.getAttribute(COLOR_SCHEME_ATTRIBUTE)).toBe('light')
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('light')
  })
})
