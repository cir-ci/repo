import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { NavItem } from '#src/NavItem.tsx'
import { NavSection } from '#src/NavSection.tsx'

function Folding() {
  const [open, setOpen] = useState(false)
  return (
    <NavSection label="Account" open={open} onOpenChange={setOpen}>
      <NavItem href="/profile">Profile</NavItem>
    </NavSection>
  )
}

describe('NavSection', () => {
  it('is a region named by its label and holds its items', async () => {
    await render(
      <NavSection label="Account">
        <NavItem href="/profile">Profile</NavItem>
      </NavSection>,
    )
    const section = page.getByRole('region', { name: 'Account' })
    await expect.element(section).toBeVisible()
    await expect.element(section.getByRole('link', { name: 'Profile' })).toBeVisible()
  })

  it('folds with its label when given open and onOpenChange, and the label is the toggle', async () => {
    await render(<Folding />)
    const toggle = page.getByRole('button', { name: 'Account' })
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(page.getByRole('link', { name: 'Profile' }).elements()).toHaveLength(0)
    await userEvent.click(toggle)
    await expect.element(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect.element(page.getByRole('link', { name: 'Profile' })).toBeVisible()
    // Still a region named by the label.
    await expect.element(page.getByRole('region', { name: 'Account' })).toBeVisible()
  })
})
