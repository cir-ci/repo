import { page } from 'vitest/browser'

/** The labels of the open menu's items, in order. */
export const menuItemNames = () =>
  page
    .getByRole('menuitem')
    .elements()
    .map((el) => el.textContent)
