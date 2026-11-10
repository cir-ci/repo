import { page } from 'vitest/browser'

/** The toast stack at the foot of the page: one polite live region named Notifications. */
export const toasts = () => page.getByRole('region', { name: 'Notifications' })

/** One toast, by the message it carries (a string matches exactly, a regular expression loosely). */
export const toastNamed = (message: string | RegExp) =>
  page.getByRole('dialog', { name: message, exact: typeof message === 'string' })
