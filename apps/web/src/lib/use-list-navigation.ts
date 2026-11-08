import { useRef } from 'react'

import { useShortcutHandlers } from './shortcuts.ts'

/** The index `delta` steps from `current` in a list of `length`, stopping at the ends; none when empty. */
export function stepIndex(length: number, current: number, delta: 1 | -1): number | undefined {
  if (length === 0) return undefined
  if (current < 0) return delta > 0 ? 0 : length - 1
  return Math.min(length - 1, Math.max(0, current + delta))
}

const FOCUSABLE = 'a[href], button, input, [tabindex]'

/**
 * J / K for a list of rows: selects the next or previous item AND moves DOM focus to its row, so
 * the selection and the focus ring never part. Put `ref` on the list and spread `rowProps(id)` on
 * each row's wrapper (the first focusable thing inside it, a `ListRow`, takes the focus).
 */
export function useListNavigation<T>({ items, getId, selectedId, onSelect }: Options<T>) {
  const ref = useRef<HTMLElement | null>(null)

  const move = (delta: 1 | -1) => {
    const index = stepIndex(
      items.length,
      items.findIndex((item) => getId(item) === selectedId),
      delta,
    )
    const item = index === undefined ? undefined : items[index]
    if (item === undefined) return
    onSelect(item)
    const row = [...(ref.current?.querySelectorAll('[data-row-id]') ?? [])].find(
      (el) => el.getAttribute('data-row-id') === getId(item),
    )
    const target = row?.matches(FOCUSABLE) ? row : row?.querySelector(FOCUSABLE)
    if (target instanceof HTMLElement) {
      target.focus()
      target.scrollIntoView({ block: 'nearest' })
    }
  }

  useShortcutHandlers({ next: () => move(1), previous: () => move(-1) })

  return { ref, rowProps: (id: string) => ({ 'data-row-id': id }) }
}

interface Options<T> {
  items: readonly T[]
  getId: (item: T) => string
  selectedId: string | undefined
  /** Called with the item J / K reached; the caller owns what "selected" means (a URL, state). */
  onSelect: (item: T) => void
}
