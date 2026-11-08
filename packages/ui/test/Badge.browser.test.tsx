import { expect, it, describe } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Badge } from '../src/index.ts'

describe('Badge', () => {
  it('renders its text with tone and shape as data attributes', async () => {
    await render(
      <Badge tone="accent" shape="tag">
        New
      </Badge>,
    )
    const badge = page.getByText('New')
    await expect.element(badge).toHaveAttribute('data-tone', 'accent')
    await expect.element(badge).toHaveAttribute('data-shape', 'tag')
  })

  it('is an 18px pill for a count and a 20px radius-4 tag for a word', async () => {
    await render(
      <>
        <Badge>3</Badge>
        <Badge shape="tag" tone="state" state="approved">
          Approved
        </Badge>
      </>,
    )
    const count = getComputedStyle(page.getByText('3').element())
    expect(count.height).toBe('18px')
    expect(count.borderTopLeftRadius).toBe('9px')
    const tag = page.getByText('Approved')
    await expect.element(tag).toHaveAttribute('data-state', 'approved')
    const tagStyle = getComputedStyle(tag.element())
    expect(tagStyle.height).toBe('20px')
    expect(tagStyle.borderTopLeftRadius).toBe('4px')
  })
})
