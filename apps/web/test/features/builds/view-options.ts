import { page } from 'vitest/browser'

/** The viewer's "View options" menu button. */
export const viewOptions = () => page.getByRole('button', { name: 'View options' })

/** Opens View options and picks what a drag draws; the menu closes with the pick. */
export async function chooseDrawing(what: 'Comments' | 'Ignore regions') {
  await viewOptions().click()
  await page.getByRole('menuitemradio', { name: what }).click()
}

/** Opens View options and switches Checkerboard; the menu closes with the pick. */
export async function toggleCheckerboard() {
  await viewOptions().click()
  await page.getByRole('menuitemcheckbox', { name: 'Checkerboard' }).click()
}
