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

  it('lays the cards out in several columns when wide and stacks them on a phone', async () => {
    await page.viewport(1280, 900)
    await renderPage(<ShortcutsPage />)
    await expect.element(page.getByRole('region', { name: 'General' })).toBeVisible()
    await expect
      .poll(() => {
        const [first, second] = cardRects()
        return first && second ? Math.abs(first.top - second.top) < 1 : false
      })
      .toBe(true)

    await page.viewport(390, 900)
    await expect
      .poll(() => {
        const rects = cardRects()
        return rects.every((r, i) => i === 0 || r.top >= (rects[i - 1]?.bottom ?? 0))
      })
      .toBe(true)
    const rects = cardRects()
    expect(new Set(rects.map((r) => Math.round(r.left))).size).toBe(1)
  })
})
