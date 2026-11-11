import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { SettingsLinkRow, SettingsSection } from '#src/index.ts'

describe('SettingsLinkRow', () => {
  it('is a link with the name, a description and a summary value', async () => {
    await render(
      <SettingsSection title="Project">
        <SettingsLinkRow
          href="/acme/web/settings/members"
          label="Members"
          detail="Who is in the project"
          value="4 members"
        />
      </SettingsSection>,
    )
    const link = page.getByRole('link', { name: /Members/ })
    await expect.element(link).toHaveAttribute('href', '/acme/web/settings/members')
    await expect.element(link.getByText('Who is in the project')).toBeVisible()
    await expect.element(link.getByText('4 members')).toBeVisible()
  })

  it('is at least 56px tall, so a phone has room to tap it', async () => {
    await render(<SettingsLinkRow href="/x" label="General" />)
    const link = page.getByRole('link', { name: 'General' }).element()
    expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(56)
  })
})
