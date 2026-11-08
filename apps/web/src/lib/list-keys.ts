const CONTROLS = 'button, input, textarea, select, summary, [role="menu"], [role="tab"]'

/**
 * Whether a list shortcut should leave the key to what has focus. Space and Enter belong to
 * buttons, menus and tabs; Enter also belongs to a focused link (it opens it, the row's own
 * click handler does the rest), but Space on a link is free to peek.
 */
export function leavesKeyToFocus(event: Pick<KeyboardEvent, 'target' | 'key'>): boolean {
  const target = event.target
  if (!(target instanceof Element)) return false
  if (target.closest(CONTROLS)) return true
  return event.key === 'Enter' && target.closest('a[href]') !== null
}

const FOCUSABLE = 'a[href], button, input, [tabindex]'

/** Moves focus to the row for `id` inside `list` (the J / K behaviour, for a selection changed by code). */
export function focusRow(list: ParentNode | null | undefined, id: string): void {
  const row = [...(list?.querySelectorAll('[data-row-id]') ?? [])].find(
    (el) => el.getAttribute('data-row-id') === id,
  )
  const target = row?.matches(FOCUSABLE) ? row : row?.querySelector(FOCUSABLE)
  if (target instanceof HTMLElement) {
    target.focus()
    target.scrollIntoView({ block: 'nearest' })
  }
}

/** The item to select once `id` leaves the list: the one after it, else the one before, else none. */
export function nextAfterRemoval<T>(
  items: readonly T[],
  getId: (item: T) => string,
  id: string,
): string | undefined {
  const index = items.findIndex((item) => getId(item) === id)
  if (index < 0) return undefined
  const neighbour = items[index + 1] ?? items[index - 1]
  return neighbour === undefined ? undefined : getId(neighbour)
}
