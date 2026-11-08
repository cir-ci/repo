import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { NavItem } from '../src/NavItem.tsx'
import { NavSection } from '../src/NavSection.tsx'

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
})
