import { page } from 'vitest/browser'

/** The toast stack at the foot of the page: one polite live region named Notifications. */
export const toasts = () => page.getByRole('region', { name: 'Notifications' })

/** One toast, by the message it carries (a string matches exactly, a regular expression loosely). */
export const toastNamed = (message: string | RegExp) =>
  page.getByRole('dialog', { name: message, exact: typeof message === 'string' })

/**
 * The dialogs open on the page, leaving out toasts: a toast is a dialog too, so "no dialog is open"
 * would otherwise fail whenever an action's toast arrives first.
 */
export const openDialogs = (): Element[] => {
  const stack = toasts().query()
  return page
    .getByRole('dialog')
    .elements()
    .filter((dialog) => !stack?.contains(dialog))
}
