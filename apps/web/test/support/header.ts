/** The page header (`PanelHeader`): a banner outside the app frame, a plain header inside `main`. */
export function pageHeader(): HTMLElement {
  const header = document.querySelector('header')
  if (!header) throw new Error('The page has no header')
  return header
}

/** A button of the header by its accessible name, or undefined. */
export const headerButton = (name: string): HTMLElement | undefined =>
  [...pageHeader().querySelectorAll<HTMLElement>('button')].find(
    (el) => (el.getAttribute('aria-label') ?? el.textContent) === name,
  )
