import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Stack } from '#src/index.ts'

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
    // The stylesheet's rules for these attributes are read from the CSS in layout-rules.test.ts;
    // here the component sets the attributes and the stylesheet applies in a page.
    expect(getComputedStyle(page.getByTestId('col').element()).display).toBe('flex')
    const row = page.getByTestId('row').element()
    expect(row.dataset['direction']).toBe('row')
    expect(row.dataset['gap']).toBe('3')
    expect(row.dataset['align']).toBe('center')
    expect(row.dataset['justify']).toBe('between')
    expect(row).toHaveAttribute('data-wrap')
    const style = getComputedStyle(row)
    expect([style.flexDirection, style.columnGap, style.flexWrap]).toEqual(['row', '12px', 'wrap'])
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
