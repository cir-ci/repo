import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Button, SectionHeader } from '../src/index.ts'

describe('SectionHeader', () => {
  it('is a heading with a description and an action', async () => {
    await render(
      <SectionHeader
        title="Webhooks"
        description="Called when a build changes."
        action={<Button>Add</Button>}
      />,
    )
    const heading = page.getByRole('heading', { name: 'Webhooks', level: 2 })
    await expect.element(heading).toBeVisible()
    const style = getComputedStyle(heading.element())
    expect([style.fontSize, style.fontWeight]).toEqual(['13px', '600'])
    await expect.element(page.getByText('Called when a build changes.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'Add' })).toBeVisible()
  })

  it('takes a heading level and a divider', async () => {
    const { container } = await render(<SectionHeader title="Danger" headingLevel={3} divided />)
    await expect.element(page.getByRole('heading', { level: 3 })).toBeVisible()
    const header = container.querySelector('header')
    expect(header && getComputedStyle(header).paddingTop).toBe('24px')
  })
})
