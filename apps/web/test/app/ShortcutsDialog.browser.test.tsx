import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'

import { ShortcutsDialog } from '#app/ShortcutsDialog.tsx'
import { shortcutGroups } from '#lib/shortcuts.ts'
import { renderPage } from '#test/support/render.tsx'

/** The rectangle of each group card in the dialog, in group order. */
function cardRects(): DOMRect[] {
  const dialog = document.querySelector('[role="dialog"]')
  return shortcutGroups().map(({ group }) => {
    const heading = Array.from(dialog?.querySelectorAll('h3') ?? []).find(
      (h) => h.textContent === group,
    )
    const card = heading?.closest('section')
    if (!card) throw new Error(`no card for ${group}`)
    return card.getBoundingClientRect()
  })
}

describe('ShortcutsDialog', () => {
  it('shows the same group cards as the page, side by side when wide and stacked on a phone', async () => {
    await page.viewport(1280, 900)
    await renderPage(<ShortcutsDialog open onOpenChange={() => {}} />)
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await Promise.all(
      shortcutGroups().map(async ({ group }) => {
        await expect.element(dialog.getByRole('region', { name: group })).toBeVisible()
      }),
    )
    // Cards, not a list: a group's rows pair an action with its key caps.
    await expect.element(dialog.getByRole('heading', { level: 3, name: 'General' })).toBeVisible()
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
  })
})
