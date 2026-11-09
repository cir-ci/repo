import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ShortcutsPage } from '#features/account/ShortcutsPage.tsx'
import { shortcutGroups } from '#lib/shortcuts.ts'
import { renderPage } from '#test/support/render.tsx'

describe('ShortcutsPage', () => {
  it('lists every group of the registry with its shortcuts', async () => {
    await page.viewport(1000, 900)
    await renderPage(<ShortcutsPage />)
    await Promise.all(
      shortcutGroups().map(async ({ group, shortcuts }) => {
        const section = page.getByRole('region', { name: group })
        await expect.element(section).toBeVisible()
        await expect.element(section.getByText(shortcuts[0]?.description ?? '')).toBeVisible()
      }),
    )
    await expect.element(page.getByText('Open the command menu')).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
  })
})
