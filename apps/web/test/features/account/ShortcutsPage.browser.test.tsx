import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ShortcutsPage } from '#features/account/ShortcutsPage.tsx'
import { shortcutGroups } from '#lib/shortcuts.ts'
import { renderPage } from '#test/support/render.tsx'

/** The rectangle of each group card, in group order. */
function cardRects(): DOMRect[] {
  return shortcutGroups().map(({ group }) => {
    const heading = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent === group)
    const card = heading?.closest('section')
    if (!card) throw new Error(`no card for ${group}`)
    return card.getBoundingClientRect()
  })
}

describe('ShortcutsPage', () => {
  it('shows each group as a card with a heading and its shortcuts', async () => {
    await page.viewport(1000, 900)
    await renderPage(<ShortcutsPage />)
    await Promise.all(
      shortcutGroups().map(async ({ group, shortcuts }) => {
        const section = page.getByRole('region', { name: group })
        await expect.element(section).toBeVisible()
        await expect.element(section.getByRole('heading', { level: 2, name: group })).toBeVisible()
        await expect.element(section.getByText(shortcuts[0]?.description ?? '')).toBeVisible()
      }),
    )
    await expect.element(page.getByText('Open the command menu')).toBeVisible()
    await expect.element(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible()
  })

  it('reads each row as an action with its keys', async () => {
    await page.viewport(1000, 900)
    await renderPage(<ShortcutsPage />)
    const term = page.getByRole('term').filter({ hasText: 'Open the command menu' })
    await expect.element(term).toBeVisible()
    const row = term.element().parentElement
    expect(row?.querySelector('dd')?.textContent).toBe('⌘K')
  })

  it('lays the cards out in several columns when wide', async () => {
    await page.viewport(1280, 900)
    await renderPage(<ShortcutsPage />)
    await expect.element(page.getByRole('region', { name: 'General' })).toBeVisible()
    await expect
      .poll(() => {
        const [first, second] = cardRects()
        return first && second ? Math.abs(first.top - second.top) < 1 : false
      })
      .toBe(true)
  })

  it('is not shown on a phone: the address goes to the profile', async () => {
    await page.viewport(390, 844)
    const { router } = await renderPage(<ShortcutsPage />, {
      route: '/account/shortcuts',
      otherRoutes: ['/account/profile'],
    })
    await expect.poll(() => router.state.location.pathname).toBe('/account/profile')
    expect(page.getByRole('heading', { name: 'Keyboard shortcuts' }).elements()).toHaveLength(0)
  })
})
