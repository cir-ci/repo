import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { ListGroup, StatusIcon } from '#src/index.ts'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ListGroup label="Unchanged" count={14} expanded={open} onExpandedChange={setOpen}>
        <ul aria-label="Unchanged rows">
          <li>one</li>
        </ul>
      </ListGroup>
    </>
  )
}

describe('ListGroup', () => {
  it('is a heading with the label and the count, and a glyph when given', async () => {
    await render(
      <ListGroup
        label="Flaky"
        count={3}
        countLabel="3 items"
        glyph={<StatusIcon status="flaky" decorative />}
      />,
    )
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'Flaky 3 items' }))
      .toBeVisible()
    expect(page.getByRole('button').elements()).toHaveLength(0)
  })

  it('is a heading of the chosen level and needs no glyph', async () => {
    await render(<ListGroup label="Today" count={2} level={3} />)
    await expect.element(page.getByRole('heading', { level: 3, name: 'Today 2' })).toBeVisible()
  })

  it('holds a disclosure button that toggles with click, Enter, Space and the arrows', async () => {
    await render(<Harness />)
    const button = page.getByRole('button', { name: 'Unchanged 14' })
    await expect.element(page.getByRole('heading', { name: 'Unchanged 14' })).toBeVisible()
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')
    await button.click()
    await expect.element(button).toHaveAttribute('aria-expanded', 'true')
    await expect.element(page.getByRole('list', { name: 'Unchanged rows' })).toBeVisible()
    // The button controls the panel that holds the rows.
    const controlled = button.element().getAttribute('aria-controls')
    expect(controlled).toBeTruthy()
    expect(
      document.getElementById(controlled ?? '')?.contains(page.getByRole('list').element()),
    ).toBe(true)
    await userEvent.keyboard('{Enter}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard(' ')
    await expect.element(button).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{ArrowLeft}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'true')
  })

  it('removes the rows while it is closed', async () => {
    await render(<Harness />)
    expect(page.getByRole('list').elements()).toHaveLength(0)
    await page.getByRole('button', { name: 'Unchanged 14' }).click()
    await expect.element(page.getByRole('list', { name: 'Unchanged rows' })).toBeVisible()
    await page.getByRole('button', { name: 'Unchanged 14' }).click()
    await expect.element(page.getByRole('list')).not.toBeInTheDocument()
  })
})
