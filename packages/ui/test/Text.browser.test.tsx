import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Text } from '../src/index.ts'

describe('Text', () => {
  it('is a 13px span by default', async () => {
    await render(<Text>Body</Text>)
    const el = page.getByText('Body').element()
    expect(el.tagName).toBe('SPAN')
    expect(getComputedStyle(el).fontSize).toBe('13px')
    expect(el).toHaveAttribute('data-tone', 'primary')
  })

  it('follows the type scale', async () => {
    await render(
      <>
        <Text variant="small">Small</Text>
        <Text variant="micro">Micro</Text>
        <Text variant="mono">Mono</Text>
      </>,
    )
    expect(getComputedStyle(page.getByText('Small').element()).fontSize).toBe('12px')
    const micro = getComputedStyle(page.getByText('Micro').element())
    expect(micro.fontSize).toBe('11px')
    expect(micro.fontWeight).toBe('500')
    expect(getComputedStyle(page.getByText('Mono').element()).fontSize).toBe('12px')
  })

  it('carries its tone, renders `as` and can truncate', async () => {
    await render(
      <Text as="p" tone="rejected" truncate>
        Failed
      </Text>,
    )
    const el = page.getByText('Failed').element()
    expect(el.tagName).toBe('P')
    expect(el).toHaveAttribute('data-tone', 'rejected')
    expect(getComputedStyle(el).textOverflow).toBe('ellipsis')
  })
})
