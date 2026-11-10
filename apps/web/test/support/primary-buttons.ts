import { expect } from 'vitest'

/** What counts as an area: each open dialog and each pane (a `Pane` is a `section[data-width]`); the rest of the page is one more. */
const AREA = '[role="dialog"], section[data-width]'
const PRIMARY = '[data-variant="primary"]'

/**
 * The "one primary button per area" rule (CLAUDE.md, Style) as one assertion: at most one
 * `variant="primary"` button in the page itself (header and body), in each dialog and in each
 * pane. Call it from a page's test once the page shows the state to check.
 */
export function expectOnePrimaryPerArea(root: ParentNode = document): void {
  const areas = [...root.querySelectorAll(AREA)]
  const inArea = (button: Element) => areas.some((area) => area.contains(button))
  const page = [...root.querySelectorAll(PRIMARY)].filter((button) => !inArea(button))
  expect(
    page.map((b) => b.textContent),
    'primary buttons in the page itself',
  ).toHaveLength(Math.min(page.length, 1))
  for (const area of areas) {
    // A pane inside a dialog (or the reverse) counts for the innermost area only.
    const own = [...area.querySelectorAll(PRIMARY)].filter(
      (button) =>
        !areas.some((inner) => inner !== area && area.contains(inner) && inner.contains(button)),
    )
    expect(
      own.map((b) => b.textContent),
      `primary buttons in ${area.getAttribute('aria-label') ?? area.tagName.toLowerCase()}`,
    ).toHaveLength(Math.min(own.length, 1))
  }
}
