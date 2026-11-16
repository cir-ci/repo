import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { ShortcutsPage } from '#features/account/ShortcutsPage.tsx'
import { isSingleKey, shortcutGroups, SHORTCUTS } from '#lib/shortcuts.ts'
import { useSingleKeyStore } from '#lib/stores/single-key-store.ts'
import { renderPage } from '#test/support/render.tsx'
import { toastNamed } from '#test/support/toast.ts'

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

  it('has a Single-key shortcuts switch, on by default, that saves at once with a toast', async () => {
    await page.viewport(1000, 900)
    await renderPage(<ShortcutsPage />)
    const toggle = page.getByRole('switch', { name: /^Single-key shortcuts/ })
    await expect.element(toggle).toBeChecked()
    await userEvent.click(toggle)
    await expect.element(toggle).not.toBeChecked()
    await expect.element(toastNamed('Single-key shortcuts off')).toBeVisible()
    expect(useSingleKeyStore.getState().enabled).toBe(false)
    expect(localStorage.getItem('circi-single-key-shortcuts')).toBe('off')
    await userEvent.click(toggle)
    expect(useSingleKeyStore.getState().enabled).toBe(true)
    await expect.element(toastNamed('Single-key shortcuts on')).toBeVisible()
  })

  it('marks the single-key rows and not the ⌘ ones', async () => {
    await page.viewport(1000, 900)
    await renderPage(<ShortcutsPage />)
    const next = page.getByRole('term').filter({ hasText: 'Next item' })
    await expect.element(next).toBeVisible()
    expect(next.element().textContent).toContain('(single key)')
    const command = page.getByRole('term').filter({ hasText: 'Open the command menu' })
    await expect.element(command).toBeVisible()
    expect(command.element().textContent).not.toContain('single key')
    expect(SHORTCUTS.filter((s) => s.key === 'mod+k').every((s) => !isSingleKey(s))).toBe(true)
  })
})
