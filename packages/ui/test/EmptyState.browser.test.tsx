import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { Button, EmptyState } from '#src/index.ts'

describe('EmptyState', () => {
  it('shows a heading, a line of text and an action', async () => {
    await render(
      <EmptyState title="No projects yet" action={<Button variant="primary">New project</Button>}>
        Create one to start comparing builds.
      </EmptyState>,
    )
    await expect
      .element(page.getByRole('heading', { name: 'No projects yet', level: 2 }))
      .toBeVisible()
    await expect.element(page.getByText('Create one to start comparing builds.')).toBeVisible()
    await expect.element(page.getByRole('button', { name: 'New project' })).toBeVisible()
  })

  it('takes the heading level of the page and hides its icon', async () => {
    const { container } = await render(<EmptyState title="Oops" headingLevel={1} tone="rejected" />)
    await expect.element(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(container.querySelector('[aria-hidden="true"] svg')).not.toBeNull()
    expect(container.querySelector('[data-tone="rejected"]')).not.toBeNull()
  })

  it('renders without description or action', async () => {
    await render(<EmptyState title="Nothing here" />)
    await expect.element(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible()
    await expect.element(page.getByRole('button')).not.toBeInTheDocument()
  })
})
