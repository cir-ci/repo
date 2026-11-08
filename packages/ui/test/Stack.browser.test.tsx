import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Stack } from '../src/index.ts'

describe('Stack', () => {
  it('is a column flex container by default and lays out in a row with a gap', async () => {
    await render(
      <>
        <Stack data-testid="col">
          <span>a</span>
        </Stack>
        <Stack data-testid="row" direction="row" gap={3} align="center" justify="between" wrap>
          <span>b</span>
        </Stack>
      </>,
    )
    const col = getComputedStyle(page.getByTestId('col').element())
    expect(col.display).toBe('flex')
    expect(col.flexDirection).toBe('column')
    const row = page.getByTestId('row').element()
    const style = getComputedStyle(row)
    expect(style.flexDirection).toBe('row')
    expect(style.columnGap).toBe('12px')
    expect(style.alignItems).toBe('center')
    expect(style.justifyContent).toBe('space-between')
    expect(style.flexWrap).toBe('wrap')
  })

  it('renders the element named by `as`', async () => {
    await render(
      <Stack as="ul" aria-label="Items">
        <li>One</li>
      </Stack>,
    )
    await expect.element(page.getByRole('list', { name: 'Items' })).toBeVisible()
  })
})
