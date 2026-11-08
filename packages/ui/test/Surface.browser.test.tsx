import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { CirciTheme, Surface } from '#src/index.ts'

describe('Surface', () => {
  it('is a panel with a 1px hairline by default', async () => {
    // CirciTheme defines the token variables the hairline uses.
    await render(
      <CirciTheme>
        <Surface data-testid="s">Content</Surface>
      </CirciTheme>,
    )
    const el = page.getByTestId('s').element()
    expect(el).toHaveAttribute('data-variant', 'panel')
    const style = getComputedStyle(el)
    expect(style.borderTopWidth).toBe('1px')
    expect(style.borderTopLeftRadius).toBe('10px')
  })

  it('has no radius as chrome and renders the element named by `as`', async () => {
    await render(
      <Surface as="aside" variant="chrome" aria-label="Sidebar">
        x
      </Surface>,
    )
    const el = page.getByRole('complementary', { name: 'Sidebar' }).element()
    expect(el).toHaveAttribute('data-variant', 'chrome')
    expect(getComputedStyle(el).borderTopLeftRadius).toBe('0px')
  })
})
